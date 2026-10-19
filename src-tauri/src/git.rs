use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
mod bulk;

#[derive(Debug, Deserialize)]
pub struct BulkFile {
    pub path: String,
    #[serde(default)]
    pub fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub repo: String,
    pub action: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub whole_file: bool,
    #[serde(default)]
    pub offset: usize,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub files: Vec<BulkFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStatus {
    path: String,
    old_path: Option<String>,
    index: String,
    worktree: String,
    conflict: bool,
}

pub fn command(repo: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.current_dir(repo)
        .args([
            "--no-pager",
            "-c",
            "core.quotepath=false",
            "-c",
            "color.ui=false",
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .env("GIT_LITERAL_PATHSPECS", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

fn bytes(repo: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut cmd = command(repo);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    let mut child = cmd.spawn().map_err(|e| format!("Cannot start Git: {e}"))?;
    if let Some(input) = input {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input)
            .map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(out.stdout)
}
fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&bytes(repo, args, None)?).into_owned())
}
fn root(repo: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(repo);
    let value = git(&path, &["rev-parse", "--show-toplevel"])?;
    fs::canonicalize(value.trim()).map_err(|e| e.to_string())
}
fn oid(repo: &Path, value: &str) -> Result<String, String> {
    if value.is_empty() || value.starts_with('-') || value.contains('\0') {
        return Err("Choose a valid commit or branch.".into());
    }
    Ok(git(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{value}^{{commit}}"),
        ],
    ).map_err(|error| format!("Cannot resolve commit or branch '{value}'. Choose an existing reference.\n{error}"))?
    .trim()
    .into())
}
fn branch(repo: &Path, value: &str) -> Result<(), String> {
    if value.starts_with('-') || value.contains('\0') {
        return Err("Invalid branch name.".into());
    }
    git(repo, &["check-ref-format", "--branch", value]).map(|_| ())
}
fn relative(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.contains('\0')
        || value.contains(':')
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.split(['/', '\\']).any(|s| s == "..")
    {
        return Err("Choose a file inside this worktree.".into());
    }
    Ok(())
}
fn file_path(repo: &Path, value: &str) -> Result<PathBuf, String> {
    relative(value)?;
    let path = fs::canonicalize(repo.join(value)).map_err(|e| e.to_string())?;
    if !path.starts_with(repo) {
        return Err("File resolves outside this worktree.".into());
    }
    Ok(path)
}
fn status(repo: &Path) -> Result<Vec<FileStatus>, String> {
    let raw = bytes(
        repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        None,
    )?;
    let mut fields = raw.split(|b| *b == 0).filter(|s| !s.is_empty());
    let mut result = Vec::new();
    while let Some(field) = fields.next() {
        if field.len() < 4 {
            continue;
        }
        let x = field[0] as char;
        let y = field[1] as char;
        let path = String::from_utf8_lossy(&field[3..]).into_owned();
        let old_path = if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            fields
                .next()
                .map(|s| String::from_utf8_lossy(s).into_owned())
        } else {
            None
        };
        result.push(FileStatus {
            path,
            old_path,
            index: x.to_string(),
            worktree: y.to_string(),
            conflict: x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D'),
        });
    }
    Ok(result)
}
fn fingerprint(repo: &Path, path: &str) -> Result<String, String> {
    fingerprint_content(repo, path, file_content(repo, path)?.as_deref())
}
fn file_content(repo: &Path, path: &str) -> Result<Option<Vec<u8>>, String> {
    relative(path)?;
    match fs::symlink_metadata(repo.join(path)) {
        Ok(meta) if meta.is_symlink() => Ok(Some(
            fs::read_link(repo.join(path))
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .as_bytes()
                .to_vec(),
        )),
        Ok(meta) if meta.is_dir() => {
            Err("Directory and submodule staging is not supported yet.".into())
        }
        Ok(_) => fs::read(repo.join(path))
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn fingerprint_content(repo: &Path, path: &str, content: Option<&[u8]>) -> Result<String, String> {
    let index = bytes(
        repo,
        &["ls-files", "--stage", "-z", "--", path],
        None,
    )?;
    Ok(fingerprint_bytes(&index, content))
}
fn fingerprint_bytes(index: &[u8], content: Option<&[u8]>) -> String {
    let mut hash = Sha256::new();
    hash.update(index);
    match content {
        Some(content) => {
            hash.update(b"present\0");
            hash.update(content);
        }
        None => hash.update(b"missing\0"),
    }
    format!("{:x}", hash.finalize())
}
fn check_fingerprint(repo: &Path, req: &Request) -> Result<(), String> {
    if req.fingerprint.is_empty() || fingerprint(repo, &req.path)? != req.fingerprint {
        return Err(
            "This file changed since you reviewed it. Refresh the diff and try again.".into(),
        );
    }
    Ok(())
}
fn records(text: &str) -> Vec<Value> {
    text.split('\0').filter_map(|record| {
        let values: Vec<_> = record.trim_start_matches(['\r', '\n']).split('\x1f').collect();
        (values.len() >= 6).then(|| json!({"id":values[0], "parents":values[1], "author":values[2], "date":values[3], "refs":values[4], "subject":values[5]}))
    }).collect()
}
fn history(repo: &Path, path: &str, search: &str, offset: usize, limit: Option<usize>) -> Result<Value, String> {
    let count = format!("--max-count={}", limit.unwrap_or(500).clamp(1, 2000));
    let skip = format!("--skip={offset}");
    let mut args = vec![
        "log",
        "--topo-order",
        &count,
        &skip,
        "--date=iso-strict",
        "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x00",
    ];
    if path.is_empty() {
        // Internal snapshots are recovery data, not normal branch history.
        // Exclude ref roots rather than commits: shared branch ancestors must remain.
        args.extend(["--exclude=refs/t3/*", "--all", "--decorate-refs-exclude=refs/t3/*"]);
    }
    if !search.is_empty() {
        args.extend(["--fixed-strings", "--regexp-ignore-case", "--grep", search]);
    }
    if !path.is_empty() {
        relative(path)?;
        args.extend(["--follow", "--", path]);
    }
    match git(repo, &args) {
        Ok(out) => Ok(json!(records(&out))),
        Err(_) if git(repo, &["rev-parse", "--verify", "HEAD"]).is_err() => Ok(json!([])),
        Err(e) => Err(e),
    }
}

pub fn is_read_only(action: &str) -> bool {
    matches!(action, "discard-plan" | "snapshot" | "status" | "history" | "diff" | "branch-files" | "commit-diff"
        | "commit-message" | "reflog" | "blame" | "conflict" | "rebase-plan")
}

fn worktrees(repo: &Path) -> Result<Vec<Value>, String> {
    Ok(git(repo, &["worktree", "list", "--porcelain", "-z"])?
        .split("\0\0").filter_map(|block| {
            let path = block.split('\0').find_map(|line| line.strip_prefix("worktree "))?;
            let branch = block.split('\0').find_map(|line| line.strip_prefix("branch refs/heads/")).unwrap_or("Detached HEAD");
            Some(json!({"path":path,"branch":branch}))
        }).collect())
}

pub fn main_repository(path: &str) -> Result<String, String> {
    worktrees(Path::new(path))?.first().and_then(|tree| tree["path"].as_str()).map(str::to_string)
        .ok_or_else(|| "No main worktree found.".into())
}

pub fn execute(req: Request) -> Result<Value, String> {
    let repo = root(&req.repo)?;
    let value = match req.action.as_str() {
        "discard-plan" | "discard-files" => {
            if req.files.is_empty() { return Err("Choose files to discard.".into()); }
            let statuses = status(&repo)?;
            let mut tracked = Vec::new();
            let mut untracked = Vec::new();
            let mut plan = Vec::new();
            for file in &req.files {
                relative(&file.path)?;
                let state = statuses.iter().find(|state| state.path == file.path)
                    .ok_or("A selected file no longer has changes. Refresh and try again.")?;
                if state.conflict || state.worktree == " " { return Err("Only non-conflicting unstaged changes can be discarded.".into()); }
                let path = repo.join(&file.path);
                let parent = path.parent().unwrap().ancestors().find(|path| path.exists()).ok_or("File parent is unavailable.")?;
                if !fs::canonicalize(parent).map_err(|e| e.to_string())?.starts_with(&repo) {
                    return Err("File resolves outside this worktree.".into());
                }
                let current = fingerprint(&repo, &file.path)?;
                if req.action == "discard-files" && (file.fingerprint.is_empty() || file.fingerprint != current) {
                    return Err(format!("{} changed since confirmation. Review the changes and try again.", file.path));
                }
                plan.push(json!({"path":file.path,"fingerprint":current}));
                if state.index == "?" { untracked.push(path); } else { tracked.push(file.path.as_str()); }
            }
            if req.action == "discard-plan" { json!(plan) } else {
                if !tracked.is_empty() {
                    let input = tracked.iter().flat_map(|path| path.bytes().chain(std::iter::once(0))).collect::<Vec<_>>();
                    bytes(&repo, &["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(&input))?;
                }
                for path in untracked { fs::remove_file(path).map_err(|e| e.to_string())?; }
                json!(format!("Discarded changes in {} files", req.files.len()))
            }
        }
        "stage-files" | "unstage-files" => {
            let stage = req.action == "stage-files";
            bulk::update(&repo, &req.files, stage).map_err(|e| format!("No files were {}. {e}", if stage { "staged" } else { "unstaged" }))?;
            json!(format!("{} files {}", req.files.len(), if stage { "staged" } else { "unstaged" }))
        }
        "status" => json!(status(&repo)?),
        "snapshot" => {
            let files = status(&repo)?;
            let refs = git(
                &repo,
                &[
                    "for-each-ref",
                    "--format=%(refname)%09%(objectname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)",
                    "refs/heads",
                    "refs/remotes",
                    "refs/tags",
                ],
            )?;
            let refs: Vec<_> = refs
                .lines()
                .filter_map(|line| {
                    let f: Vec<_> = line.split('\t').collect();
                    if f.len() < 5 { return None; }
                    let count = |prefix: &str| f[4].split(',').find_map(|part| part.trim().strip_prefix(prefix)?.parse::<usize>().ok()).unwrap_or(0);
                    Some(json!({"name":f[0],"id":f[1],"current":f[2]=="*","upstream":f[3],
                        "ahead":count("ahead "),"behind":count("behind "),"upstreamGone":f[4]=="gone"}))
                })
                .collect();
            let branch = git(&repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
                .unwrap_or_else(|_| "Detached HEAD".into());
            let worktrees = worktrees(&repo)?;
            let repository_root = worktrees.first().and_then(|tree| tree["path"].as_str()).unwrap_or(&req.repo);
            let gitdir = git(&repo, &["rev-parse", "--absolute-git-dir"])?;
            let gitdir = Path::new(gitdir.trim());
            let operation =
                if gitdir.join("rebase-merge").exists() || gitdir.join("rebase-apply").exists() {
                    "rebase"
                } else if gitdir.join("MERGE_HEAD").exists() {
                    "merge"
                } else if gitdir.join("CHERRY_PICK_HEAD").exists() {
                    "cherry-pick"
                } else if gitdir.join("REVERT_HEAD").exists() {
                    "revert"
                } else {
                    ""
                };
            let stashes = git(&repo, &["stash", "list", "--format=%gd%x09%s"])?;
            let remotes = git(&repo, &["remote", "-v"])?;
            json!({"root":repo.to_string_lossy().trim_start_matches("\\\\?\\"),"repositoryRoot":repository_root,"branch":branch.trim(),"files":files,"refs":refs,"worktrees":worktrees,"operation":operation,"stashes":stashes,"remotes":remotes,"head":git(&repo,&["rev-parse","--verify","HEAD"]).unwrap_or_default().trim()})
        }
        "history" => history(&repo, &req.path, &req.text, req.offset, req.limit)?,
        "diff" => {
            relative(&req.path)?;
            let before = fingerprint(&repo, &req.path)?;
            let mut args = vec![
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-renames",
                // Git doubles the context when joining hunks; i32::MAX overflows
                // and repeats overlapping whole-file hunks for separated edits.
                if req.whole_file { "--unified=1000000000" } else { "--unified=3" },
            ];
            let target;
            if req.mode == "staged" {
                args.push("--cached");
            } else if req.mode == "branch" {
                let base = oid(&repo, &req.target)?;
                target = git(&repo, &["merge-base", "HEAD", &base])?
                    .trim()
                    .to_string();
                args.push(&target);
            }
            args.extend(["--", &req.path]);
            let mut diff = git(&repo, &args)?;
            if diff.is_empty()
                && req.mode == "working"
                && git(&repo, &["ls-files", "--error-unmatch", "--", &req.path]).is_err()
            {
                let content = fs::read(file_path(&repo, &req.path)?).map_err(|e| e.to_string())?;
                if content.contains(&0) {
                    diff = "Binary file (untracked)".into();
                } else {
                    let text = String::from_utf8_lossy(&content);
                    let lines: Vec<_> = text.split_inclusive('\n').collect();
                    diff = format!("diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n@@ -0,0 +1,{1} @@\n", req.path, lines.len());
                    for line in lines {
                        diff.push('+');
                        diff.push_str(line);
                        if !line.ends_with('\n') {
                            diff.push_str("\n\\ No newline at end of file\n");
                        }
                    }
                }
            }
            if before != fingerprint(&repo, &req.path)? {
                return Err(
                    "File changed while loading. Refresh to review its current content.".into(),
                );
            }
            json!({"text":diff,"fingerprint":before})
        }
        "branch-files" => {
            let base = oid(&repo, &req.target)?;
            let base = git(&repo, &["merge-base", "HEAD", &base])?;
            let out = bytes(
                &repo,
                &["diff", "--name-only", "-z", base.trim(), "--"],
                None,
            )?;
            json!(out
                .split(|b| *b == 0)
                .filter(|b| !b.is_empty())
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .collect::<Vec<_>>())
        }
        "commit-diff" => {
            let target = oid(&repo, &req.target)?;
            json!(git(
                &repo,
                &[
                    "show",
                    "--format=fuller",
                    "--no-ext-diff",
                    "--no-textconv",
                    &target,
                    "--"
                ]
            )?)
        }
        "commit-message" => {
            let target = oid(&repo, &req.target)?;
            json!(git(&repo, &["show", "-s", "--format=%B", &target])?)
        }
        "stage" | "unstage" => {
            check_fingerprint(&repo, &req)?;
            if req.action == "stage" {
                // Stage the reviewed bytes, not a later version an agent may write
                // between the fingerprint check and Git opening the file.
                let content = file_content(&repo, &req.path)?;
                if fingerprint_content(&repo, &req.path, content.as_deref())? != req.fingerprint {
                    return Err("The file changed. Refresh before staging.".into());
                }
                if let Some(content) = content {
                    let index = git(&repo, &["ls-files", "--stage", "--", &req.path])?;
                    if index.is_empty()
                        && git(&repo, &["check-ignore", "--quiet", "--", &req.path]).is_ok()
                    {
                        return Err("This file is ignored by Git.".into());
                    }
                    let meta =
                        fs::symlink_metadata(repo.join(&req.path)).map_err(|e| e.to_string())?;
                    let mut mode = if meta.is_symlink() {
                        "120000"
                    } else if index.starts_with("100755") {
                        "100755"
                    } else {
                        "100644"
                    };
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if !meta.is_symlink() {
                            mode = if meta.permissions().mode() & 0o111 != 0 {
                                "100755"
                            } else {
                                "100644"
                            };
                        }
                    }
                    let hash_args = if meta.is_symlink() {
                        vec!["hash-object", "-w", "--stdin"]
                    } else {
                        vec!["hash-object", "-w", "--stdin", "--path", &req.path]
                    };
                    let blob = bytes(&repo, &hash_args, Some(&content))?;
                    let blob = String::from_utf8_lossy(&blob);
                    git(
                        &repo,
                        &[
                            "update-index",
                            "--add",
                            "--cacheinfo",
                            mode,
                            blob.trim(),
                            &req.path,
                        ],
                    )?;
                } else {
                    git(&repo, &["update-index", "--force-remove", "--", &req.path])?;
                }
            } else if git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok() {
                git(&repo, &["restore", "--staged", "--", &req.path])?;
            } else {
                git(&repo, &["rm", "--cached", "--", &req.path])?;
            }
            json!("Index updated")
        }
        "patch" => {
            check_fingerprint(&repo, &req)?;
            if !req.text.starts_with("diff --git ") || req.text.matches("diff --git ").count() != 1
            {
                return Err("Expected a single-file patch.".into());
            }
            // Let Git decode quoted/unusual filenames, then require exactly the reviewed path.
            let stat = bytes(
                &repo,
                &["apply", "--numstat", "-z", "--recount"],
                Some(req.text.as_bytes()),
            )?;
            let paths: Vec<_> = stat.split(|b| *b == 0).filter(|v| !v.is_empty()).collect();
            if paths.len() != 1
                || paths[0].splitn(3, |b| *b == b'\t').nth(2) != Some(req.path.as_bytes())
            {
                return Err("Patch does not match the reviewed file.".into());
            }
            let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
            if req.mode == "staged" {
                args.push("--reverse");
            }
            args.push("--check");
            bytes(&repo, &args, Some(req.text.as_bytes()))?;
            args.pop();
            bytes(&repo, &args, Some(req.text.as_bytes()))?;
            json!("Selected changes staged")
        }
        "commit" | "amend" => {
            if req.text.trim().is_empty() {
                return Err("Write a commit message first.".into());
            }
            let mut args = vec!["commit", "-F", "-"];
            if req.action == "amend" {
                args.push("--amend");
            }
            let out = bytes(&repo, &args, Some(req.text.as_bytes()))?;
            json!(String::from_utf8_lossy(&out))
        }
        "fetch" => json!(git(&repo, &["fetch", "--all", "--prune"])?),
        "pull" => json!(git(&repo, &["pull", "--ff-only"])?),
        "push" => {
            let args = if req.mode == "force" {
                vec!["push", "--force-with-lease"]
            } else {
                vec!["push"]
            };
            json!(git(&repo, &args)?)
        }
        "switch" => {
            branch(&repo, &req.target)?;
            json!(git(&repo, &["switch", &req.target])?)
        }
        "branch-create" => {
            branch(&repo, &req.text)?;
            let target = oid(
                &repo,
                if req.target.is_empty() {
                    "HEAD"
                } else {
                    &req.target
                },
            )?;
            json!(git(&repo, &["branch", &req.text, &target])?)
        }
        "branch-delete" => {
            branch(&repo, &req.target)?;
            let flag = if req.mode == "force" { "-D" } else { "-d" };
            json!(git(&repo, &["branch", flag, &req.target])?)
        }
        "tag-create" => {
            branch(&repo, &req.text)?;
            let target = oid(&repo, &req.target)?;
            json!(git(&repo, &["tag", &req.text, &target])?)
        }
        "tag-delete" => {
            branch(&repo, &req.target)?;
            json!(git(&repo, &["tag", "-d", &req.target])?)
        }
        "rebase-onto" => {
            let target = oid(&repo, &req.target)?;
            if !status(&repo)?.is_empty() {
                return Err("Commit or stash changes before rebasing.".into());
            }
            json!(git(&repo, &["rebase", &target])?)
        }
        "merge" => {
            let target = oid(&repo, &req.target)?;
            json!(git(&repo, &["merge", "--no-edit", &target])?)
        }
        "cherry-pick" | "revert" => {
            let target = oid(&repo, &req.target)?;
            json!(git(&repo, &[&req.action, "--no-edit", &target])?)
        }
        "reset" => {
            if !["soft", "mixed", "hard"].contains(&req.mode.as_str()) {
                return Err("Invalid reset mode.".into());
            }
            let target = oid(&repo, &req.target)?;
            json!(git(&repo, &["reset", &format!("--{}", req.mode), &target])?)
        }
        "stash-save" => json!(git(
            &repo,
            &[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                if req.text.is_empty() {
                    "GitGoblin stash"
                } else {
                    &req.text
                }
            ]
        )?),
        "stash-apply" | "stash-drop" => {
            if !req.target.starts_with("stash@{")
                || !req.target.ends_with('}')
                || req.target[7..req.target.len() - 1].parse::<u32>().is_err()
            {
                return Err("Choose a stash.".into());
            }
            json!(git(
                &repo,
                &[
                    "stash",
                    if req.action == "stash-apply" {
                        "apply"
                    } else {
                        "drop"
                    },
                    &req.target
                ]
            )?)
        }
        "reflog" => json!(git(
            &repo,
            &["reflog", "-100", "--date=iso", "--format=%H%x09%gd%x09%gs"]
        )?),
        "blame" => {
            relative(&req.path)?;
            json!(git(&repo, &["blame", "--date=short", "--", &req.path])?)
        }
        "remote-add" => {
            branch(&repo, &req.target)?;
            if req.text.starts_with('-') || req.text.is_empty() || req.text.contains('\0') {
                return Err("Enter a remote URL.".into());
            }
            json!(git(&repo, &["remote", "add", &req.target, &req.text])?)
        }
        "remote-remove" => {
            branch(&repo, &req.target)?;
            json!(git(&repo, &["remote", "remove", &req.target])?)
        }
        "conflict" => {
            relative(&req.path)?;
            let read_stage = |stage: u8| {
                git(&repo, &["show", &format!(":{stage}:{}", req.path)]).unwrap_or_default()
            };
            let content = match file_content(&repo, &req.path)? {
                Some(bytes) => String::from_utf8(bytes).map_err(|_| {
                    "Binary conflicts require choosing a version in an external editor."
                })?,
                None => String::new(),
            };
            json!({"base":read_stage(1),"ours":read_stage(2),"theirs":read_stage(3),"result":content,"fingerprint":fingerprint(&repo,&req.path)?})
        }
        "resolve" => {
            check_fingerprint(&repo, &req)?;
            relative(&req.path)?;
            let candidate = repo.join(&req.path);
            let parent = fs::canonicalize(candidate.parent().ok_or("Invalid conflict path")?)
                .map_err(|e| e.to_string())?;
            if !parent.starts_with(&repo) {
                return Err("Conflict path resolves outside this worktree.".into());
            }
            let path = if candidate.exists() {
                file_path(&repo, &req.path)?
            } else {
                candidate
            };
            fs::write(path, req.text.as_bytes()).map_err(|e| e.to_string())?;
            git(&repo, &["add", "--", &req.path])?;
            json!("Conflict resolved and staged")
        }
        "continue" | "abort" => {
            if !["merge", "rebase", "cherry-pick", "revert"].contains(&req.mode.as_str()) {
                return Err("No supported operation in progress.".into());
            }
            let mut cmd = command(&repo);
            cmd.env("GIT_EDITOR", "true").args([
                req.mode.as_str(),
                if req.action == "continue" {
                    "--continue"
                } else {
                    "--abort"
                },
            ]);
            let out = cmd.output().map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err(String::from_utf8_lossy(&out.stderr).into_owned());
            }
            json!(String::from_utf8_lossy(&out.stdout))
        }
        "rebase-plan" => {
            let base = oid(&repo, &req.target)?;
            if !git(&repo, &["rev-list", "--merges", &format!("{base}..HEAD")])?
                .trim()
                .is_empty()
            {
                return Err("This range contains merge commits. Choose a linear range for interactive rebase.".into());
            }
            json!(records(&git(
                &repo,
                &[
                    "log",
                    "--reverse",
                    "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x00",
                    &format!("{base}..HEAD")
                ]
            )?))
        }
        "rebase" => {
            let base = oid(&repo, &req.target)?;
            if !git(&repo, &["rev-list", "--merges", &format!("{base}..HEAD")])?
                .trim()
                .is_empty()
            {
                return Err("This range contains merge commits. Choose a linear range for interactive rebase.".into());
            }
            if !status(&repo)?.is_empty() {
                return Err("Commit or stash changes before rebasing.".into());
            }
            let allowed = git(&repo, &["rev-list", &format!("{base}..HEAD")])?;
            let mut seen = std::collections::HashSet::new();
            let mut todo = String::new();
            let mut has_kept_commit = false;
            for line in req.text.lines() {
                let parts: Vec<_> = line.splitn(3, ' ').collect();
                if parts.len() < 2
                    || !["pick", "squash", "fixup", "drop", "edit"].contains(&parts[0])
                    || !allowed.lines().any(|id| id == parts[1])
                    || !seen.insert(parts[1])
                {
                    return Err("Invalid rebase plan. Reload the commits.".into());
                }
                if ["squash", "fixup"].contains(&parts[0]) && !has_kept_commit {
                    return Err("Squash and fixup need an earlier kept commit.".into());
                }
                if parts[0] != "drop" {
                    has_kept_commit = true;
                }
                todo.push_str(&format!("{} {}\n", parts[0], parts[1]));
            }
            if seen.len() != allowed.lines().count() {
                return Err("Every commit must appear exactly once in the plan.".into());
            }
            let dir = git(&repo, &["rev-parse", "--absolute-git-dir"])?;
            let todo_path = Path::new(dir.trim()).join("gitgoblin-rebase-todo");
            fs::write(&todo_path, todo).map_err(|e| e.to_string())?;
            let executable = std::env::current_exe().map_err(|e| e.to_string())?;
            let quote = |p: &Path| {
                format!(
                    "'{}'",
                    p.to_string_lossy()
                        .replace('\\', "/")
                        .replace('\'', "'\\''")
                )
            };
            let mut cmd = command(&repo);
            cmd.env(
                "GIT_SEQUENCE_EDITOR",
                format!(
                    "{} --sequence-editor {}",
                    quote(&executable),
                    quote(&todo_path)
                ),
            )
            .env("GIT_EDITOR", "true")
            .args(["rebase", "-i", &base]);
            let out = cmd.output().map_err(|e| e.to_string())?;
            let _ = fs::remove_file(todo_path);
            if !out.status.success() {
                return Err(format!(
                    "{}\nResolve conflicts or amend the paused commit, then continue or abort.",
                    String::from_utf8_lossy(&out.stderr)
                ));
            }
            json!(String::from_utf8_lossy(&out.stdout))
        }
        "worktree-remove" => {
            if !Path::new(&req.path).is_absolute() { return Err("Choose an absolute worktree path.".into()); }
            let target = fs::canonicalize(&req.path).map_err(|e| e.to_string())?;
            let trees = worktrees(&repo)?;
            let position = trees.iter().position(|tree| tree["path"].as_str()
                .and_then(|path| fs::canonicalize(path).ok()).as_ref() == Some(&target))
                .ok_or("This folder is not a registered worktree of this repository.")?;
            if position == 0 { return Err("The main worktree cannot be removed.".into()); }
            if target == repo { return Err("Switch to another worktree before removing the open worktree.".into()); }
            // Git refuses dirty or locked worktrees; never force or delete folders ourselves.
            json!(git(&repo, &["worktree", "remove", "--", &target.to_string_lossy()])?)
        }
        "worktree-add" => {
            branch(&repo, &req.text)?;
            let target = oid(&repo, &req.target)?;
            if !Path::new(&req.path).is_absolute() || Path::new(&req.path).exists() {
                return Err("Choose a new, unused absolute worktree folder.".into());
            }
            json!(git(
                &repo,
                &["worktree", "add", "-b", &req.text, "--", &req.path, &target]
            )?)
        }
        _ => return Err("Unknown Git action.".into()),
    };
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init"]).unwrap();
        git(dir.path(), &["config", "user.name", "GitGoblin Test"]).unwrap();
        git(
            dir.path(),
            &["config", "user.email", "test@example.invalid"],
        )
        .unwrap();
        git(dir.path(), &["config", "commit.gpgsign", "false"]).unwrap();
        git(dir.path(), &["config", "core.autocrlf", "false"]).unwrap();
        git(
            dir.path(),
            &["config", "core.hooksPath", ".git/no-test-hooks"],
        )
        .unwrap();
        dir
    }
    fn request(dir: &Path, action: &str) -> Request {
        Request {
            repo: dir.to_string_lossy().into(),
            action: action.into(),
            path: String::new(),
            target: String::new(),
            text: String::new(),
            mode: String::new(),
            fingerprint: String::new(),
            whole_file: false,
            offset: 0,
            limit: None,
            files: Vec::new(),
        }
    }
    #[test]
    fn force_push_rewrites_history_but_preserves_unseen_remote_commits() {
        let dir = fixture();
        let repo = dir.path();
        let remote = tempfile::tempdir().unwrap();
        git(remote.path(), &["init", "--bare"]).unwrap();
        git(repo, &["checkout", "-b", "main"]).unwrap();
        git(repo, &["remote", "add", "origin", remote.path().to_str().unwrap()]).unwrap();
        git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
        git(repo, &["push", "-u", "origin", "main"]).unwrap();
        let push = |mode: &str| {
            let mut req = request(repo, "push");
            req.mode = mode.into();
            execute(req)
        };

        git(repo, &["commit", "--allow-empty", "-m", "next"]).unwrap();
        push("").unwrap();
        assert_eq!(oid(remote.path(), "main").unwrap(), oid(repo, "HEAD").unwrap());
        git(repo, &["commit", "--amend", "--allow-empty", "-m", "rewritten"]).unwrap();
        assert!(push("").is_err());
        push("force").unwrap();
        let published = oid(repo, "HEAD").unwrap();
        assert_eq!(oid(remote.path(), "main").unwrap(), published);

        // Advance the remote without updating this repository's tracking ref.
        let tree = git(repo, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let unseen = git(repo, &["commit-tree", tree.trim(), "-p", &published, "-m", "someone else's commit"]).unwrap();
        git(repo, &["push", "origin", &format!("{}:refs/heads/main", unseen.trim())]).unwrap();
        git(repo, &["update-ref", "refs/remotes/origin/main", &published]).unwrap();
        git(repo, &["commit", "--amend", "--allow-empty", "-m", "rewritten again"]).unwrap();
        assert!(push("force").unwrap_err().contains("stale info"));
        assert_eq!(oid(remote.path(), "main").unwrap(), unseen.trim());
    }

    #[test]
    fn branch_deletion_requires_explicit_force_for_unmerged_commits() {
        let dir = fixture();
        let repo = dir.path();
        git(repo, &["checkout", "-b", "base"]).unwrap();
        git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
        git(repo, &["checkout", "-b", "feature/unmerged"]).unwrap();
        git(repo, &["commit", "--allow-empty", "-m", "unmerged"]).unwrap();
        let tip = oid(repo, "HEAD").unwrap();
        git(repo, &["checkout", "base"]).unwrap();

        let delete = |target: &str, mode: &str| {
            let mut req = request(repo, "branch-delete");
            req.target = target.into();
            req.mode = mode.into();
            execute(req)
        };
        assert!(delete("feature/unmerged", "").unwrap_err().contains("not fully merged"));
        assert_eq!(oid(repo, "feature/unmerged").unwrap(), tip);
        delete("feature/unmerged", "force").unwrap();
        assert!(oid(repo, "feature/unmerged").is_err());

        git(repo, &["branch", "merged"]).unwrap();
        delete("merged", "").unwrap();
        assert!(oid(repo, "merged").is_err());
        assert!(delete("base", "force").is_err());
        assert!(oid(repo, "base").is_ok());

        let worktrees = tempfile::tempdir().unwrap();
        let linked = worktrees.path().join("linked");
        git(repo, &["worktree", "add", "-b", "linked", linked.to_str().unwrap()]).unwrap();
        assert!(delete("linked", "force").is_err());
        assert!(oid(repo, "linked").is_ok());
        assert!(delete("--all", "force").unwrap_err().contains("Invalid branch name"));
    }

    #[test]
    fn discard_restores_index_preserves_staging_and_rejects_stale_confirmation() {
        let dir = fixture();
        let repo = dir.path();
        fs::create_dir(repo.join("folder")).unwrap();
        fs::write(repo.join("folder/file.txt"), "original").unwrap();
        git(repo, &["add", "."]).unwrap();
        git(repo, &["commit", "-m", "initial"]).unwrap();
        fs::write(repo.join("folder/file.txt"), "staged").unwrap();
        git(repo, &["add", "."]).unwrap();
        fs::write(repo.join("folder/file.txt"), "unstaged").unwrap();
        fs::write(repo.join("folder/new [1].txt"), "new").unwrap();
        fs::write(repo.join("keep.txt"), "keep").unwrap();
        let mut plan = request(repo, "discard-plan");
        plan.files = vec![BulkFile { path: "folder/file.txt".into(), fingerprint: String::new() }, BulkFile { path: "folder/new [1].txt".into(), fingerprint: String::new() }];
        let files = execute(plan).unwrap();
        let mut discard = request(repo, "discard-files");
        discard.files = serde_json::from_value(files.clone()).unwrap();
        fs::write(repo.join("folder/new [1].txt"), "changed").unwrap();
        assert!(execute(discard).unwrap_err().contains("changed since confirmation"));
        assert_eq!(fs::read_to_string(repo.join("folder/file.txt")).unwrap(), "unstaged");
        fs::write(repo.join("folder/new [1].txt"), "new").unwrap();
        let mut discard = request(repo, "discard-files");
        discard.files = serde_json::from_value(files).unwrap();
        execute(discard).unwrap();
        assert_eq!(fs::read_to_string(repo.join("folder/file.txt")).unwrap(), "staged");
        assert_eq!(git(repo, &["show", ":folder/file.txt"]).unwrap(), "staged");
        assert!(!repo.join("folder/new [1].txt").exists());
        assert!(repo.join("keep.txt").exists());
    }
    #[test]
    fn removes_only_clean_registered_linked_worktrees_and_groups_recent_repositories() {
        let dir = fixture();
        let repo = dir.path();
        git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
        let parent = tempfile::tempdir().unwrap();
        let linked = parent.path().join("linked tree");
        let path = linked.to_string_lossy().to_string();
        git(repo, &["worktree", "add", "-b", "linked", &path]).unwrap();
        let snapshot = execute(request(&linked, "snapshot")).unwrap();
        assert_eq!(fs::canonicalize(snapshot["repositoryRoot"].as_str().unwrap()).unwrap(), fs::canonicalize(repo).unwrap());
        let history = tempfile::tempdir().unwrap();
        let saved = vec![path.clone(), repo.to_string_lossy().to_string()];
        // Simulate an existing history file written before worktree grouping.
        fs::write(history.path().join("repositories.json"), serde_json::to_vec(&saved).unwrap()).unwrap();
        let roots = crate::preferences::load_repositories(history.path()).unwrap().unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(fs::canonicalize(&roots[0]).unwrap(), fs::canonicalize(repo).unwrap());
        crate::preferences::save_repositories(history.path(), &saved).unwrap();
        assert_eq!(crate::preferences::load_repositories(history.path()).unwrap().unwrap(), roots);
        let remove = |from: &Path, target: &str| {
            let mut req = request(from, "worktree-remove");
            req.path = target.into();
            execute(req)
        };
        assert!(remove(repo, &repo.to_string_lossy()).unwrap_err().contains("main worktree"));
        assert!(remove(&linked, &path).unwrap_err().contains("open worktree"));
        assert!(remove(repo, &history.path().to_string_lossy()).unwrap_err().contains("not a registered"));
        fs::write(linked.join("untracked.txt"), "keep me").unwrap();
        assert!(remove(repo, &path).is_err());
        assert_eq!(fs::read_to_string(linked.join("untracked.txt")).unwrap(), "keep me");
        fs::remove_file(linked.join("untracked.txt")).unwrap();
        git(repo, &["worktree", "lock", &path]).unwrap();
        assert!(remove(repo, &path).is_err());
        git(repo, &["worktree", "unlock", &path]).unwrap();
        remove(repo, &path).unwrap();
        assert!(!linked.exists());
        assert_eq!(worktrees(repo).unwrap().len(), 1);
        assert!(oid(repo, "linked").is_ok());
    }

    #[test]
    fn snapshot_reports_divergence_and_missing_upstreams() {
        let dir = fixture();
        let repo = dir.path();
        git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
        let base = git(repo, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        git(repo, &["remote", "add", "origin", "."]).unwrap();
        git(repo, &["update-ref", "refs/remotes/origin/main", &base]).unwrap();
        git(repo, &["checkout", "-b", "topic"]).unwrap();
        git(repo, &["branch", "--set-upstream-to=origin/main", "topic"]).unwrap();
        let branch = |name: &str| {
            let snapshot = execute(request(repo, "snapshot")).unwrap();
            snapshot["refs"].as_array().unwrap().iter().find(|r| r["name"] == format!("refs/heads/{name}")).unwrap().clone()
        };
        assert_eq!(branch("topic")["ahead"], 0);
        assert_eq!(branch("topic")["behind"], 0);
        git(repo, &["commit", "--allow-empty", "-m", "local"]).unwrap();
        assert_eq!(branch("topic")["ahead"], 1);
        assert_eq!(branch("topic")["behind"], 0);
        let tree = git(repo, &["rev-parse", "HEAD^{tree}"]).unwrap().trim().to_string();
        let remote = git(repo, &["commit-tree", &tree, "-p", &base, "-m", "remote"]).unwrap().trim().to_string();
        git(repo, &["update-ref", "refs/remotes/origin/main", &remote]).unwrap();
        assert_eq!(branch("topic")["ahead"], 1);
        assert_eq!(branch("topic")["behind"], 1);
        git(repo, &["branch", "behind", &base]).unwrap();
        git(repo, &["branch", "--set-upstream-to=origin/main", "behind"]).unwrap();
        assert_eq!(branch("behind")["ahead"], 0);
        assert_eq!(branch("behind")["behind"], 1);
        git(repo, &["branch", "unpublished"]).unwrap();
        assert_eq!(branch("unpublished")["upstream"], "");
        assert_eq!(branch("unpublished")["upstreamGone"], false);
        git(repo, &["update-ref", "-d", "refs/remotes/origin/main"]).unwrap();
        assert_eq!(branch("topic")["upstreamGone"], true);
        assert_eq!(branch("topic")["ahead"], 0);
    }

    #[test]
    fn whole_file_diff_includes_context_for_working_and_staged_changes() {
        let dir = fixture();
        let original = (1..=40).map(|n| format!("line {n}\n")).collect::<String>();
        fs::write(dir.path().join("file.txt"), &original).unwrap();
        git(dir.path(), &["add", "."]).unwrap();
        git(dir.path(), &["commit", "-m", "initial"]).unwrap();
        fs::write(dir.path().join("file.txt"), original.replace("line 20\n", "changed\n").replace("line 35\n", "second change\n")).unwrap();
        let diff = |mode: &str, whole_file: bool| {
            let mut req = request(dir.path(), "diff");
            req.path = "file.txt".into();
            req.mode = mode.into();
            req.whole_file = whole_file;
            execute(req).unwrap()
        };
        let small = diff("working", false);
        assert!(!small["text"].as_str().unwrap().contains(" line 1\n"));
        let full = diff("working", true);
        let text = full["text"].as_str().unwrap();
        assert_eq!(text.lines().filter(|line| line.starts_with("@@ ")).count(), 1);
        assert_eq!(text.lines().filter(|line| *line == " line 1").count(), 1);
        for expected in [" line 1\n", " line 40\n", "-line 20\n", "+changed\n"] {
            assert!(full["text"].as_str().unwrap().contains(expected));
        }
        assert_eq!(small["fingerprint"], full["fingerprint"]);
        git(dir.path(), &["add", "."]).unwrap();
        assert_eq!(diff("staged", true)["text"], full["text"]);
    }

    #[test]
    fn history_hides_internal_checkpoint_refs_without_hiding_branch_ancestors() {
        let dir = fixture();
        fs::write(dir.path().join("file.txt"), "original\n").unwrap();
        git(dir.path(), &["add", "."]).unwrap();
        git(dir.path(), &["commit", "-m", "t3 checkpoint mentioned in a real commit"]).unwrap();
        let head = git(dir.path(), &["rev-parse", "HEAD"]).unwrap();
        let tree = git(dir.path(), &["rev-parse", "HEAD^{tree}"]).unwrap();
        let checkpoint = git(dir.path(), &["commit-tree", tree.trim(), "-p", head.trim(), "-m", "internal snapshot"]).unwrap();
        let reference = "refs/t3/checkpoints/test/turn/1";
        git(dir.path(), &["update-ref", reference, checkpoint.trim()]).unwrap();
        let result = execute(request(dir.path(), "history")).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["id"], head.trim());
        // The hidden snapshot is still available for T3 recovery.
        assert_eq!(git(dir.path(), &["rev-parse", reference]).unwrap().trim(), checkpoint.trim());
        // Explicitly branching from a snapshot makes it normal branch history.
        git(dir.path(), &["branch", "recovered", checkpoint.trim()]).unwrap();
        let recovered = execute(request(dir.path(), "history")).unwrap();
        assert_eq!(recovered.as_array().unwrap().len(), 2);
    }

    #[test]
    fn history_pages_past_150_without_gaps_and_filters_before_paging() {
        let dir = fixture();
        let mut input = String::new();
        for i in 0..160 {
            let message = format!("history {i}");
            input.push_str(&format!("commit refs/heads/history\ncommitter Test <test@example.invalid> {} +0000\ndata {}\n{}\n\n", 1700000000 + i, message.len(), message));
        }
        let mut process = command(dir.path()).args(["fast-import", "--quiet"])
            .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().unwrap();
        process.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
        assert!(process.wait_with_output().unwrap().status.success());
        git(dir.path(), &["symbolic-ref", "HEAD", "refs/heads/history"]).unwrap();
        let all = execute(request(dir.path(), "history")).unwrap();
        assert_eq!(all.as_array().unwrap().len(), 160);
        let mut first = request(dir.path(), "history");
        first.limit = Some(100);
        let first = execute(first).unwrap();
        let mut second = request(dir.path(), "history");
        second.limit = Some(100);
        second.offset = 100;
        let second = execute(second).unwrap();
        let combined: Vec<_> = first.as_array().unwrap().iter().chain(second.as_array().unwrap()).cloned().collect();
        assert_eq!(combined, *all.as_array().unwrap());
        let mut filtered = request(dir.path(), "history");
        filtered.text = "history 15".into();
        filtered.limit = Some(3);
        filtered.offset = 2;
        let filtered = execute(filtered).unwrap();
        assert_eq!(filtered.as_array().unwrap().len(), 3);
        assert_eq!(filtered[0]["subject"], "history 157");
    }

    #[test]
    fn comparison_reports_a_missing_branch() {
        let dir = fixture();
        let mut req = request(dir.path(), "branch-files");
        req.target = "missing-branch".into();
        assert!(execute(req).unwrap_err().contains("Cannot resolve commit or branch 'missing-branch'"));
    }
    #[test]
    fn status_preserves_unusual_names_and_stale_stage_fails() {
        let dir = fixture();
        let path = "a file [1].txt";
        fs::write(dir.path().join(path), "one\n").unwrap();
        let files = status(dir.path()).unwrap();
        assert_eq!(files[0].path, path);
        let mut req = request(dir.path(), "stage");
        req.path = path.into();
        req.fingerprint = fingerprint(dir.path(), path).unwrap();
        fs::write(dir.path().join(path), "two\n").unwrap();
        assert!(execute(req).unwrap_err().contains("changed"));
        assert!(git(dir.path(), &["diff", "--cached"]).unwrap().is_empty());
    }
    #[test]
    fn rebases_current_branch_onto_local_and_remote_branches() {
        for target in ["refs/heads/base", "refs/remotes/origin/base"] {
            let dir = fixture();
            let repo = dir.path();
            git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
            git(repo, &["branch", "base"]).unwrap();
            git(repo, &["switch", "-c", "feature"]).unwrap();
            fs::write(repo.join("feature.txt"), "feature\n").unwrap();
            git(repo, &["add", "."]).unwrap();
            git(repo, &["commit", "-m", "feature"]).unwrap();
            let original = git(repo, &["rev-parse", "HEAD"]).unwrap();
            git(repo, &["switch", "base"]).unwrap();
            fs::write(repo.join("base.txt"), "base\n").unwrap();
            git(repo, &["add", "."]).unwrap();
            git(repo, &["commit", "-m", "base"]).unwrap();
            git(repo, &["update-ref", "refs/remotes/origin/base", "base"]).unwrap();
            git(repo, &["switch", "feature"]).unwrap();
            let mut req = request(repo, "rebase-onto");
            req.target = target.into();
            execute(req).unwrap();
            assert_eq!(git(repo, &["branch", "--show-current"]).unwrap().trim(), "feature");
            assert_ne!(git(repo, &["rev-parse", "HEAD"]).unwrap(), original);
            git(repo, &["merge-base", "--is-ancestor", "base", "HEAD"]).unwrap();
            assert!(repo.join("base.txt").exists() && repo.join("feature.txt").exists());
            fs::write(repo.join("feature.txt"), "unsaved\n").unwrap();
            let mut req = request(repo, "rebase-onto");
            req.target = target.into();
            assert!(execute(req).unwrap_err().contains("Commit or stash"));
        }
    }

    #[test]
    fn branch_switch_preserves_local_changes_and_rebase_conflicts_can_be_aborted() {
        let dir = fixture();
        let repo = dir.path();
        fs::write(repo.join("file.txt"), "initial\n").unwrap();
        git(repo, &["add", "."]).unwrap();
        git(repo, &["commit", "-m", "initial"]).unwrap();
        git(repo, &["branch", "base"]).unwrap();
        git(repo, &["switch", "-c", "feature"]).unwrap();
        fs::write(repo.join("file.txt"), "feature\n").unwrap();
        git(repo, &["commit", "-am", "feature"]).unwrap();
        let original = git(repo, &["rev-parse", "HEAD"]).unwrap();
        git(repo, &["switch", "base"]).unwrap();
        fs::write(repo.join("file.txt"), "base\n").unwrap();
        git(repo, &["commit", "-am", "base"]).unwrap();
        let mut req = request(repo, "switch");
        req.target = "feature".into();
        execute(req).unwrap();
        fs::write(repo.join("file.txt"), "local edits\n").unwrap();
        let mut req = request(repo, "switch");
        req.target = "base".into();
        assert!(execute(req).is_err());
        assert_eq!(fs::read_to_string(repo.join("file.txt")).unwrap(), "local edits\n");
        fs::write(repo.join("file.txt"), "feature\n").unwrap();
        let mut req = request(repo, "rebase-onto");
        req.target = "base".into();
        assert!(execute(req).is_err());
        assert_eq!(execute(request(repo, "snapshot")).unwrap()["operation"], "rebase");
        let mut req = request(repo, "abort");
        req.mode = "rebase".into();
        execute(req).unwrap();
        assert_eq!(git(repo, &["rev-parse", "HEAD"]).unwrap(), original);
        assert_eq!(fs::read_to_string(repo.join("file.txt")).unwrap(), "feature\n");
    }

    #[test]
    fn bulk_stages_and_unstages_598_files_with_one_index_replacement() {
        let dir = fixture();
        let repo = dir.path();
        fs::create_dir(repo.join("nested")).unwrap();
        let files: Vec<_> = (0..598).map(|i| {
            let path = format!("nested/file {i} [test].txt");
            fs::write(repo.join(&path), format!("content {i}\n")).unwrap();
            BulkFile { path, fingerprint: String::new() }
        }).collect();
        let started = std::time::Instant::now();
        let mut req = request(repo, "stage-files");
        req.files = files.iter().map(|file| BulkFile { path: file.path.clone(), fingerprint: String::new() }).collect();
        execute(req).unwrap();
        println!("Bulk stage 598 files: {:?}", started.elapsed());
        let staged = status(repo).unwrap();
        assert_eq!(staged.len(), 598);
        assert!(staged.iter().all(|file| file.index == "A" && file.worktree == " "));
        let started = std::time::Instant::now();
        let mut req = request(repo, "unstage-files");
        req.files = files.iter().map(|file| BulkFile { path: file.path.clone(), fingerprint: String::new() }).collect();
        execute(req).unwrap();
        println!("Bulk unstage 598 files (unborn branch): {:?}", started.elapsed());
        assert!(git(repo, &["ls-files"]).unwrap().is_empty());
        assert!(files.iter().all(|file| repo.join(&file.path).exists()));
        assert!(!repo.join(".git/index.lock").exists());
    }

    #[test]
    fn bulk_preserves_filters_deletions_and_unselected_files() {
        let dir = fixture();
        let repo = dir.path();
        fs::write(repo.join(".gitattributes"), "*.txt text eol=lf\n").unwrap();
        fs::write(repo.join("remove.txt"), "remove\n").unwrap();
        fs::write(repo.join("keep.txt"), "before\n").unwrap();
        fs::write(repo.join("already.txt"), "before\n").unwrap();
        git(repo, &["add", "."]).unwrap();
        git(repo, &["commit", "-m", "initial"]).unwrap();
        fs::write(repo.join("already.txt"), "previously staged\n").unwrap();
        git(repo, &["add", "already.txt"]).unwrap();
        fs::remove_file(repo.join("remove.txt")).unwrap();
        fs::write(repo.join("keep.txt"), "not selected\n").unwrap();
        fs::write(repo.join("new [1].txt"), "line one\r\nline two\r\n").unwrap();
        let files: Vec<_> = ["new [1].txt", "remove.txt"].iter().map(|path| BulkFile { path: (*path).into(), fingerprint: fingerprint(repo, path).unwrap() }).collect();
        bulk::update(repo, &files, true).unwrap();
        assert_eq!(git(repo, &["show", ":new [1].txt"]).unwrap(), "line one\nline two\n");
        assert_eq!(git(repo, &["show", ":keep.txt"]).unwrap(), "before\n");
        assert_eq!(git(repo, &["show", ":already.txt"]).unwrap(), "previously staged\n");
        assert!(git(repo, &["show", ":remove.txt"]).is_err());
        let without_review: Vec<_> = files.iter().map(|file| BulkFile { path: file.path.clone(), fingerprint: String::new() }).collect();
        bulk::update(repo, &without_review, false).unwrap();
        assert_eq!(git(repo, &["diff", "--cached", "--name-only"]).unwrap().trim(), "already.txt");
        assert!(!repo.join("remove.txt").exists());
        assert_eq!(fs::read(repo.join("new [1].txt")).unwrap(), b"line one\r\nline two\r\n");
    }

    #[test]
    fn bulk_rejects_stale_files_and_preserves_existing_locks_without_partial_staging() {
        let dir = fixture();
        let repo = dir.path();
        git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
        fs::write(repo.join("first.txt"), "first\n").unwrap();
        fs::write(repo.join("second.txt"), "second\n").unwrap();
        let files: Vec<_> = ["first.txt", "second.txt"].iter().map(|path| BulkFile { path: (*path).into(), fingerprint: fingerprint(repo, path).unwrap() }).collect();
        let index = fs::read(repo.join(".git/index")).unwrap();
        fs::write(repo.join("second.txt"), "agent edit\n").unwrap();
        assert!(bulk::update(repo, &files, true).unwrap_err().contains("changed since review"));
        assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index);
        assert!(!repo.join(".git/index.lock").exists());
        fs::write(repo.join(".git/index.lock"), "another process owns this").unwrap();
        assert!(bulk::update(repo, &files, true).unwrap_err().contains("index is busy"));
        assert_eq!(fs::read_to_string(repo.join(".git/index.lock")).unwrap(), "another process owns this");
        assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index);
    }

    #[test]
    fn bulk_git_errors_leave_the_index_unchanged_and_a_retry_works() {
        let dir = fixture();
        let repo = dir.path();
        fs::write(repo.join(".gitignore"), "ignored.txt\n").unwrap();
        git(repo, &["add", ".gitignore"]).unwrap();
        git(repo, &["commit", "-m", "initial"]).unwrap();
        let index = fs::read(repo.join(".git/index")).unwrap();
        fs::write(repo.join("good.txt"), "good\n").unwrap();
        fs::write(repo.join("ignored.txt"), "ignored\n").unwrap();
        let files: Vec<_> = ["good.txt", "ignored.txt"].iter().map(|path| BulkFile { path: (*path).into(), fingerprint: String::new() }).collect();
        assert!(bulk::update(repo, &files, true).is_err());
        assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index);
        assert!(!repo.join(".git/index.lock").exists());
        bulk::update(repo, &files[..1], true).unwrap();
        assert_eq!(git(repo, &["show", ":good.txt"]).unwrap(), "good\n");
    }

    #[test]
    fn bulk_stages_captured_bytes_even_if_a_clean_filter_edits_the_live_file() {
        let dir = fixture();
        let repo = dir.path();
        let original = repo.join("file.txt").to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
        git(repo, &["config", "filter.test.clean", &format!("printf 'later edit\\n' > '{original}'; cat")]).unwrap();
        fs::write(repo.join(".gitattributes"), "*.txt filter=test\n").unwrap();
        fs::write(repo.join("file.txt"), "captured\n").unwrap();
        let files: Vec<_> = [".gitattributes", "file.txt"].iter().map(|path| BulkFile { path: (*path).into(), fingerprint: String::new() }).collect();
        bulk::update(repo, &files, true).unwrap();
        assert_eq!(git(repo, &["show", ":file.txt"]).unwrap(), "captured\n");
        assert_eq!(fs::read_to_string(repo.join("file.txt")).unwrap(), "later edit\n");
    }

    #[test]
    fn bulk_updates_only_the_selected_linked_worktree_index() {
        let dir = fixture();
        let repo = dir.path();
        git(repo, &["commit", "--allow-empty", "-m", "initial"]).unwrap();
        let parent = tempfile::tempdir().unwrap();
        let linked = parent.path().join("linked workspace");
        git(repo, &["worktree", "add", "-b", "linked", linked.to_str().unwrap()]).unwrap();
        fs::write(linked.join("one.txt"), "one\n").unwrap();
        fs::write(linked.join("two.txt"), "two\n").unwrap();
        let files: Vec<_> = ["one.txt", "two.txt"].iter().map(|path| BulkFile { path: (*path).into(), fingerprint: String::new() }).collect();
        bulk::update(&linked, &files, true).unwrap();
        assert_eq!(git(&linked, &["ls-files"]).unwrap().lines().count(), 2);
        assert!(git(repo, &["ls-files"]).unwrap().is_empty());
        bulk::update(&linked, &files, false).unwrap();
        assert!(git(&linked, &["ls-files"]).unwrap().is_empty());
    }

    #[test]
    fn bulk_timing_compared_with_repeated_file_operations() {
        let dir = fixture();
        let repo = dir.path();
        let files: Vec<_> = (0..8).map(|i| {
            let path = format!("file{i}.txt");
            fs::write(repo.join(&path), "content\n").unwrap();
            BulkFile { path, fingerprint: String::new() }
        }).collect();
        let start = std::time::Instant::now();
        for file in &files {
            let mut diff = request(repo, "diff");
            diff.path = file.path.clone();
            let current = execute(diff).unwrap();
            let mut req = request(repo, "stage");
            req.path = file.path.clone();
            req.fingerprint = current["fingerprint"].as_str().unwrap().into();
            execute(req).unwrap();
        }
        let sequential = start.elapsed();
        bulk::update(repo, &files, false).unwrap();
        let start = std::time::Instant::now();
        bulk::update(repo, &files, true).unwrap();
        println!("8 files: previous per-file path {:?}; bulk {:?}", sequential, start.elapsed());
    }

    #[test]
    fn lightweight_status_matches_snapshot_after_staging_and_unstaging() {
        let dir = fixture();
        fs::write(dir.path().join("file.txt"), "one\n").unwrap();
        for action in ["stage", "unstage"] {
            let mut req = request(dir.path(), action);
            req.path = "file.txt".into();
            req.fingerprint = fingerprint(dir.path(), "file.txt").unwrap();
            execute(req).unwrap();
            let start = std::time::Instant::now();
            let files = execute(request(dir.path(), "status")).unwrap();
            let status_elapsed = start.elapsed();
            let start = std::time::Instant::now();
            let snapshot = execute(request(dir.path(), "snapshot")).unwrap();
            println!("After {action}: status {:?}, full snapshot {:?}", status_elapsed, start.elapsed());
            assert_eq!(files, snapshot["files"]);
            assert_eq!(files[0]["index"], if action == "stage" { "A" } else { "?" });
        }
        assert!(is_read_only("status"));
    }

    #[test]
    fn stage_commit_unstage_and_history() {
        let dir = fixture();
        fs::write(dir.path().join("file.txt"), "one\n").unwrap();
        let mut req = request(dir.path(), "stage");
        req.path = "file.txt".into();
        req.fingerprint = fingerprint(dir.path(), "file.txt").unwrap();
        execute(req).unwrap();
        let mut req = request(dir.path(), "commit");
        req.text = "First commit".into();
        execute(req).unwrap();
        assert_eq!(
            execute(request(dir.path(), "history"))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        fs::write(dir.path().join("file.txt"), "two\n").unwrap();
        let mut req = request(dir.path(), "stage");
        req.path = "file.txt".into();
        req.fingerprint = fingerprint(dir.path(), "file.txt").unwrap();
        execute(req).unwrap();
        let mut req = request(dir.path(), "unstage");
        req.path = "file.txt".into();
        req.fingerprint = fingerprint(dir.path(), "file.txt").unwrap();
        execute(req).unwrap();
        assert!(git(dir.path(), &["diff", "--cached"]).unwrap().is_empty());
    }
    #[test]
    fn rejects_paths_and_option_injection() {
        assert!(relative("../outside").is_err());
        assert!(relative("C:\\outside").is_err());
        let dir = fixture();
        assert!(oid(dir.path(), "--help").is_err());
        assert!(branch(dir.path(), "--help").is_err());
    }
    #[test]
    fn binary_staging_and_deleted_file_staging() {
        let dir = fixture();
        let path = "binary.dat";
        fs::write(dir.path().join(path), [0, 1, 2, 255]).unwrap();
        let mut req = request(dir.path(), "stage");
        req.path = path.into();
        req.fingerprint = fingerprint(dir.path(), path).unwrap();
        execute(req).unwrap();
        assert_eq!(
            bytes(dir.path(), &["show", ":binary.dat"], None).unwrap(),
            vec![0, 1, 2, 255]
        );
        git(dir.path(), &["commit", "-m", "binary"]).unwrap();
        fs::remove_file(dir.path().join(path)).unwrap();
        let mut req = request(dir.path(), "stage");
        req.path = path.into();
        req.fingerprint = fingerprint(dir.path(), path).unwrap();
        execute(req).unwrap();
        assert!(git(dir.path(), &["ls-files"]).unwrap().is_empty());
    }
    #[test]
    fn patch_cannot_write_another_file() {
        let dir = fixture();
        fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        fs::write(dir.path().join("b.txt"), "one\n").unwrap();
        git(dir.path(), &["add", "."]).unwrap();
        git(dir.path(), &["commit", "-m", "base"]).unwrap();
        fs::write(dir.path().join("b.txt"), "two\n").unwrap();
        let patch = git(dir.path(), &["diff", "--", "b.txt"]).unwrap();
        let mut req = request(dir.path(), "patch");
        req.path = "a.txt".into();
        req.fingerprint = fingerprint(dir.path(), "a.txt").unwrap();
        req.text = patch;
        assert!(execute(req).unwrap_err().contains("reviewed file"));
        assert!(git(dir.path(), &["diff", "--cached"]).unwrap().is_empty());
    }
}
