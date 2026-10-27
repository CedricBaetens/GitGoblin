use std::{path::{Path, PathBuf}, process::Command};

fn external_url(url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "Invalid link.".to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        return Err("Only web and email links can be opened.".into());
    }
    Ok(url)
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let url = external_url(url)?;
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(not(any(windows, target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command.arg(url.as_str()).spawn().map_err(|e| format!("Could not open link: {e}"))?;
    Ok(())
}

pub fn worktree_path(repo: &str, path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(repo).map_err(|e| e.to_string())?;
    if !root.is_dir() { return Err("Choose a repository folder.".into()); }
    if path.contains('\0') || path.contains(':') || path.starts_with(['/', '\\'])
        || path.split(['/', '\\']).any(|part| part == "..") {
        return Err("Choose a path inside this worktree.".into());
    }
    let target = root.join(path);
    // Deleted files still have a useful full path and an existing parent to reveal.
    let existing = target.ancestors().find(|parent| parent.exists()).ok_or("Path is unavailable.")?;
    if !std::fs::canonicalize(existing).map_err(|e| e.to_string())?.starts_with(&root) {
        return Err("Path must be within the worktree.".into());
    }
    Ok(target)
}

pub fn reveal(target: &Path) -> Result<(), String> {
    let existing = target.ancestors().find(|parent| parent.exists()).ok_or("Path is unavailable.")?;
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        let path = existing.to_string_lossy();
        let path = path.trim_start_matches("\\\\?\\");
        if existing.is_dir() { command.arg(path); }
        else { command.arg(format!("/select,{path}")); }
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        if existing.is_file() { command.arg("-R"); }
        command.arg(existing);
        command
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(if existing.is_dir() { existing } else { existing.parent().ok_or("No parent folder.")? });
        command
    };
    command.spawn().map_err(|e| format!("Could not reveal the path: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_opens_web_and_email_urls() {
        for url in ["https://example.com/path?q=a&b=c#section", "http://localhost:1420", "mailto:hello@example.com"] {
            assert!(external_url(url).is_ok());
        }
        for url in ["javascript:alert(1)", "file:///C:/Windows/test.exe", "C:/Windows/test.exe", "relative/path", "data:text/html,test"] {
            assert!(external_url(url).is_err());
        }
    }
    #[test]
    fn resolves_files_folders_and_deleted_paths_without_allowing_escape() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        std::fs::write(dir.path().join("nested/a file.txt"), "content").unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        assert_eq!(worktree_path(repo, "").unwrap(), root);
        assert_eq!(worktree_path(repo, "nested/a file.txt").unwrap(), root.join("nested/a file.txt"));
        assert_eq!(worktree_path(repo, "nested/deleted.txt").unwrap(), root.join("nested/deleted.txt"));
        for path in ["../outside", "nested/../../outside", "C:/outside", "/outside", "\\outside", "bad\0path"] {
            assert!(worktree_path(repo, path).is_err(), "Accepted {path:?}");
        }
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_outside_the_worktree() {
        let repo = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), repo.path().join("link")).unwrap();
        assert!(worktree_path(repo.path().to_str().unwrap(), "link/missing.txt").is_err());
    }
}
