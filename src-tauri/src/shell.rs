use std::{path::{Path, PathBuf}, process::Command};

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
