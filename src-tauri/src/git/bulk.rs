use super::*;
use std::collections::{HashMap, HashSet};

// Only remove the index lock that this operation successfully created.
struct IndexLock {
    path: PathBuf,
    file: Option<fs::File>,
    committed: bool,
}
impl IndexLock {
    fn acquire(index: &Path) -> Result<Self, String> {
        let mut name = index.as_os_str().to_os_string();
        name.push(".lock");
        let path = PathBuf::from(name);
        let file = fs::OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists {
                "Git's index is busy (index.lock exists). Wait for the other Git operation to finish, then retry. The existing lock was left untouched.".to_string()
            } else { e.to_string() })?;
        Ok(Self { path, file: Some(file), committed: false })
    }
    fn commit(&mut self, prepared: &Path, index: &Path) -> Result<(), String> {
        let file = self.file.as_mut().unwrap();
        std::io::copy(&mut fs::File::open(prepared).map_err(|e| e.to_string())?, file).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(self.file.take());
        fs::rename(&self.path, index).map_err(|e| e.to_string())?;
        self.committed = true;
        Ok(())
    }
}
impl Drop for IndexLock {
    fn drop(&mut self) {
        drop(self.file.take());
        if !self.committed { let _ = fs::remove_file(&self.path); }
    }
}

fn index_git(repo: &Path, gitdir: &Path, index: &Path, worktree: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let mut cmd = command(repo);
    cmd.current_dir(worktree).env("GIT_DIR", gitdir).env("GIT_WORK_TREE", worktree).env("GIT_INDEX_FILE", index)
        .args(args).stdout(Stdio::piped()).stderr(Stdio::piped())
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() });
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(input) = input {
        child.stdin.take().unwrap().write_all(input).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().to_string()); }
    Ok(output.stdout)
}

pub(super) fn update(repo: &Path, files: &[BulkFile], stage: bool) -> Result<(), String> {
    let canonical = fs::canonicalize(repo).map_err(|e| e.to_string())?;
    let repo = canonical.as_path();
    if files.is_empty() { return Err("Choose files to update.".into()); }
    let mut selected = HashSet::new();
    for file in files {
        relative(&file.path)?;
        if !selected.insert(file.path.as_str()) { return Err("The batch contains duplicate file paths.".into()); }
    }
    let gitdir = PathBuf::from(git(repo, &["rev-parse", "--absolute-git-dir"])?.trim());
    let index = repo.join(git(repo, &["rev-parse", "--git-path", "index"])?.trim());
    let mut lock = IndexLock::acquire(&index)?;
    let prepared = tempfile::NamedTempFile::new_in(&gitdir).map_err(|e| e.to_string())?.into_temp_path();
    if index.exists() { fs::copy(&index, &prepared).map_err(|e| e.to_string())?; }
    else {
        fs::remove_file(&prepared).map_err(|e| e.to_string())?;
        index_git(repo, &gitdir, &prepared, repo, &["read-tree", "--empty"], None)?;
    }

    // One index read supplies every file's original fingerprint and conflict state.
    let raw = bytes(repo, &["ls-files", "--stage", "-z"], None)?;
    let mut entries: HashMap<String, Vec<u8>> = HashMap::new();
    for record in raw.split_inclusive(|byte| *byte == 0) {
        let Some(tab) = record.iter().position(|byte| *byte == b'\t') else { continue; };
        let path = String::from_utf8_lossy(&record[tab + 1..record.len() - 1]);
        if !selected.contains(path.as_ref()) { continue; }
        if !record[..tab].ends_with(b" 0") { return Err("Resolve conflicting files before staging these changes.".into()); }
        entries.entry(path.into_owned()).or_default().extend_from_slice(record);
    }
    let snapshot = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut attributes = HashSet::new();
    let mut paths = Vec::new();
    let mut links = Vec::new();
    for file in files {
        let source = repo.join(&file.path);
        let parent = source.parent().unwrap().ancestors().find(|path| path.exists()).ok_or("File parent is unavailable.")?;
        if !fs::canonicalize(parent).map_err(|e| e.to_string())?.starts_with(repo) {
            return Err("File resolves outside this worktree.".into());
        }
        let content = file_content(repo, &file.path)?;
        if !file.fingerprint.is_empty() && fingerprint_bytes(entries.get(&file.path).map(Vec::as_slice).unwrap_or_default(), content.as_deref()) != file.fingerprint {
            return Err(format!("{} changed since review. Refresh and try again.", file.path));
        }
        if stage {
            if let Some(content) = content {
                let meta = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
                if meta.is_symlink() {
                    if !entries.contains_key(&file.path) && git(repo, &["check-ignore", "--quiet", "--", &file.path]).is_ok() {
                        return Err(format!("{} is ignored by Git.", file.path));
                    }
                    links.push((&file.path, content));
                    continue;
                }
                let destination = snapshot.path().join(&file.path);
                fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
                fs::write(&destination, content).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                fs::set_permissions(&destination, meta.permissions()).map_err(|e| e.to_string())?;
            }
            for parent in Path::new(&file.path).parent().unwrap().ancestors() { attributes.insert(parent.to_path_buf()); }
        }
        paths.extend_from_slice(file.path.as_bytes());
        paths.push(0);
    }
    // Use Git's normal clean filters and ignore rules at the original relative paths.
    // The snapshot makes later agent edits remain unstaged, rather than staging unseen bytes.
    for parent in attributes {
        for name in [".gitattributes", ".gitignore"] {
            let relative = parent.join(name);
            if selected.contains(relative.to_string_lossy().replace('\\', "/").as_str()) { continue; }
            let source = repo.join(&relative);
            if fs::symlink_metadata(&source).map(|meta| meta.is_file()).unwrap_or(false) {
                let destination = snapshot.path().join(relative);
                fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
                fs::write(destination, fs::read(source).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            }
        }
    }
    if !paths.is_empty() {
        let mut pathspec = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        pathspec.write_all(&paths).map_err(|e| e.to_string())?;
        let option = format!("--pathspec-from-file={}", pathspec.path().to_string_lossy());
        if stage {
            index_git(repo, &gitdir, &prepared, snapshot.path(), &["add", "-A", &option, "--pathspec-file-nul"], None)?;
        } else if git(repo, &["rev-parse", "--verify", "HEAD"]).is_ok() {
            index_git(repo, &gitdir, &prepared, repo, &["restore", "--source=HEAD", "--staged", &option, "--pathspec-file-nul"], None)?;
        } else {
            index_git(repo, &gitdir, &prepared, repo, &["update-index", "--force-remove", "-z", "--stdin"], Some(&paths))?;
        }
    }
    if !links.is_empty() {
        let mut info = Vec::new();
        for (path, content) in links {
            let oid = bytes(repo, &["hash-object", "-w", "--stdin"], Some(&content))?;
            info.extend_from_slice(format!("120000 {}\t{path}\0", String::from_utf8_lossy(&oid).trim()).as_bytes());
        }
        index_git(repo, &gitdir, &prepared, repo, &["update-index", "-z", "--index-info"], Some(&info))?;
    }
    lock.commit(&prepared, &index)
}
