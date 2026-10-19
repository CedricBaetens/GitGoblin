use serde_json::{json, Value};
use std::{env, path::Path, process::{Command, Stdio}};

#[derive(Debug, PartialEq)]
struct Project {
    organization: String,
    project: String,
}

fn decode_segment(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut input = value.as_bytes().iter().copied();
    while let Some(byte) = input.next() {
        bytes.push(if byte == b'%' {
            let high = input.next().and_then(|c| (c as char).to_digit(16));
            let low = input.next().and_then(|c| (c as char).to_digit(16));
            ((high.ok_or("Invalid Azure DevOps remote.")? << 4) | low.ok_or("Invalid Azure DevOps remote.")?) as u8
        } else { byte });
    }
    String::from_utf8(bytes).map_err(|_| "Invalid Azure DevOps remote.".into())
}

fn project_from_remote(remote: &str) -> Result<Project, String> {
    let remote = remote.trim();
    let url = if let Some(path) = remote.strip_prefix("git@ssh.dev.azure.com:v3/") {
        format!("https://dev.azure.com/{path}")
    } else { remote.to_string() };
    let url = reqwest::Url::parse(&url).map_err(|_| "This repository has no Azure DevOps origin.")?;
    let host = url.host_str().unwrap_or("");
    let mut parts: Vec<String> = url.path_segments().into_iter().flatten().filter(|part| !part.is_empty())
        .map(decode_segment).collect::<Result<_, _>>()?;
    let organization = if host == "dev.azure.com" || host == "ssh.dev.azure.com" {
        if host == "ssh.dev.azure.com" && parts.first().is_some_and(|part| part == "v3") { parts.remove(0); }
        if parts.is_empty() { return Err("Invalid Azure DevOps remote.".into()); }
        parts.remove(0)
    } else if let Some(org) = host.strip_suffix(".visualstudio.com") {
        if parts.first().is_some_and(|part| part == "DefaultCollection") { parts.remove(0); }
        org.to_string()
    } else { return Err("This repository has no Azure DevOps origin. Enter a ticket reference manually.".into()); };
    if organization.is_empty() || !organization.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("Invalid Azure DevOps organization.".into());
    }
    let project = match parts.as_slice() {
        [project, git, _repo] if git == "_git" => project.clone(),
        [git, repo] if git == "_git" => repo.clone(),
        [project, _repo] => project.clone(),
        _ => return Err("Cannot determine the Azure DevOps project from this origin.".into()),
    };
    Ok(Project { organization: format!("https://dev.azure.com/{organization}"), project })
}

fn wiql(project: &str, search: &str) -> String {
    let literal = |value: &str| format!("'{}'", value.replace('\'', "''"));
    let search = search.trim();
    let id = search.strip_prefix('#').unwrap_or(search).parse::<u64>().ok();
    let filter = if search.is_empty() {
        "[System.AssignedTo] = @Me AND [System.State] NOT IN ('Closed', 'Done', 'Removed')".into()
    } else if let Some(id) = id {
        format!("[System.Id] = {id}")
    } else { format!("[System.Title] CONTAINS {}", literal(search)) };
    format!("SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = {} AND ({filter}) ORDER BY [System.ChangedDate] DESC", literal(project))
}

fn azure_cli() -> Result<Command, String> {
    #[cfg(windows)]
    {
        for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
            let executable = directory.join("az.exe");
            let python = directory.join("..").join("python.exe");
            let mut command = if executable.is_file() { Command::new(executable) }
            else if directory.join("az.cmd").is_file() && python.is_file() {
                let mut command = Command::new(python);
                command.args(["-IBm", "azure.cli"]);
                command
            } else { continue; };
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
            return Ok(command);
        }
        Err("Install Azure CLI and its Azure DevOps extension to search tickets. You can still enter a ticket manually.".into())
    }
    #[cfg(not(windows))]
    { Ok(Command::new("az")) }
}

fn ticket_results(project: &Project, items: &Value) -> Value {
    let tickets: Vec<Value> = items.as_array().into_iter().flatten().take(30).filter_map(|item| {
        let id = item.get("id")?.as_u64()?;
        let fields = item.get("fields")?;
        let mut url = reqwest::Url::parse(&project.organization).ok()?;
        url.path_segments_mut().ok()?.extend([project.project.as_str(), "_workitems", "edit", &id.to_string()]);
        Some(json!({
            "id": id, "title": fields.get("System.Title").and_then(Value::as_str).unwrap_or("Untitled ticket"),
            "state": fields.get("System.State").and_then(Value::as_str).unwrap_or(""),
            "kind": fields.get("System.WorkItemType").and_then(Value::as_str).unwrap_or(""),
            "assignedTo": fields.pointer("/System.AssignedTo/displayName").and_then(Value::as_str).unwrap_or(""),
            "url": url.as_str(),
        }))
    }).collect();
    json!({ "organization": project.organization, "project": project.project, "tickets": tickets })
}

pub fn tickets(repo: &str, search: &str) -> Result<Value, String> {
    if search.chars().count() > 200 { return Err("Search by a ticket number or a shorter title.".into()); }
    let repo = std::fs::canonicalize(Path::new(repo)).map_err(|_| "Choose a local worktree to search its Azure DevOps project.")?;
    let remote = crate::git::command(&repo).args(["remote", "get-url", "origin"]).output().map_err(|_| "Cannot read the repository origin.")?;
    if !remote.status.success() { return Err("This repository has no origin. Enter a ticket reference manually.".into()); }
    let project = project_from_remote(&String::from_utf8_lossy(&remote.stdout))?;
    let output = azure_cli()?.current_dir(&repo).args([
        "boards", "query", "--org", &project.organization, "--project", &project.project,
        "--wiql", &wiql(&project.project, search), "--output", "json", "--only-show-errors",
    ]).env("AZURE_EXTENSION_USE_DYNAMIC_INSTALL", "no").stdin(Stdio::null()).output()
        .map_err(|_| "Cannot start Azure CLI. Install its Azure DevOps extension and sign in first.")?;
    if !output.status.success() {
        return Err("Azure DevOps search failed. Check your Azure CLI sign-in and access to this project, then retry.".into());
    }
    // Azure CLI returns no output when a WIQL query finds no tickets.
    let items = if output.stdout.is_empty() { json!([]) } else {
        serde_json::from_slice(&output.stdout).map_err(|_| "Azure DevOps returned an unexpected response.")?
    };
    if !items.is_array() { return Err("Azure DevOps returned an unexpected response.".into()); }
    Ok(ticket_results(&project, &items))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_azure_remote_formats_and_decodes_project_names() {
        for remote in ["https://dev.azure.com/Acme/My%20Project/_git/Repo", "git@ssh.dev.azure.com:v3/Acme/My%20Project/Repo", "ssh://git@ssh.dev.azure.com/v3/Acme/My%20Project/Repo", "https://Acme.visualstudio.com/DefaultCollection/My%20Project/_git/Repo"] {
            let project = project_from_remote(remote).unwrap();
            assert_eq!(project.organization.to_lowercase(), "https://dev.azure.com/acme");
            assert_eq!(project.project, "My Project");
        }
        assert_eq!(project_from_remote("https://dev.azure.com/Acme/_git/Rex").unwrap().project, "Rex");
        assert!(project_from_remote("https://github.com/Acme/Repo").is_err());
        assert!(project_from_remote("https://dev.azure.com.evil.test/Acme/Project/_git/Repo").is_err());
    }
    #[test]
    fn searches_ids_or_escaped_titles_within_the_repository_project() {
        assert!(wiql("Rex", "").contains("[System.AssignedTo] = @Me"));
        assert!(wiql("Rex", "#42").contains("[System.Id] = 42"));
        let query = wiql("Team's Project", "O'Brien");
        assert!(query.contains("[System.TeamProject] = 'Team''s Project'"));
        assert!(query.contains("[System.Title] CONTAINS 'O''Brien'"));
        assert!(!query.contains("@project"));
    }
    #[test]
    fn maps_ticket_fields_and_builds_a_browser_reference() {
        let project = Project { organization: "https://dev.azure.com/Acme".into(), project: "My Project".into() };
        let result = ticket_results(&project, &json!([{ "id":42, "fields":{
            "System.Title":"Fix login", "System.State":"Active", "System.WorkItemType":"Bug",
            "System.AssignedTo": {"displayName":"Developer"}
        }}]));
        assert_eq!(result["tickets"][0]["url"], "https://dev.azure.com/Acme/My%20Project/_workitems/edit/42");
        assert_eq!(result["tickets"][0]["assignedTo"], "Developer");
    }
}
