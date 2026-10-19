use std::{fs, io::Write, path::Path};

pub fn load_repositories(directory: &Path) -> Result<Option<Vec<String>>, String> {
    load_repository_list(directory, "repositories.json", 12)
}

pub fn load_favorites(directory: &Path) -> Result<Option<Vec<String>>, String> {
    load_repository_list(directory, "favorites.json", usize::MAX)
}

fn load_repository_list(directory: &Path, filename: &str, limit: usize) -> Result<Option<Vec<String>>, String> {
    match fs::read(directory.join(filename)) {
        Ok(bytes) => {
            let saved: Vec<String> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            Ok(Some(repository_roots(&saved).into_iter().take(limit).collect()))
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_repositories(directory: &Path, repositories: &[String]) -> Result<(), String> {
    save_repository_list(directory, "repositories.json", repositories, 12)
}

pub fn save_favorites(directory: &Path, repositories: &[String]) -> Result<(), String> {
    save_repository_list(directory, "favorites.json", repositories, usize::MAX)
}

fn save_repository_list(directory: &Path, filename: &str, repositories: &[String], limit: usize) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&repository_roots(repositories).into_iter().take(limit).collect::<Vec<_>>()).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(directory.join(filename)).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_repository_names(directory: &Path) -> Result<std::collections::HashMap<String, String>, String> {
    match fs::read(directory.join("repository-names.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(std::collections::HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_repository_names(directory: &Path, names: &std::collections::HashMap<String, String>) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(names).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(directory.join("repository-names.json")).map_err(|e| e.to_string())?;
    Ok(())
}

fn repository_roots(repositories: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    repositories.iter().map(|path| crate::git::main_repository(path).unwrap_or_else(|_| path.clone()))
        .filter(|path| {
            let key = path.replace('\\', "/").trim_end_matches('/').to_string();
            seen.insert(if cfg!(windows) { key.to_lowercase() } else { key })
        }).collect()
}

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("dev.gitgoblin.desktop", "t3-session").map_err(|e| e.to_string())
}

pub fn save_pairing(session: &(String, String)) -> Result<(), String> {
    save_pairing_to(&credential()?, session)
}

fn save_pairing_to(entry: &keyring::Entry, session: &(String, String)) -> Result<(), String> {
    entry.set_password(&serde_json::to_string(session).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Could not save T3 pairing: {e}"))
}

pub fn load_pairing() -> Result<Option<(String, String)>, String> {
    load_pairing_from(&credential()?)
}

fn load_pairing_from(entry: &keyring::Entry) -> Result<Option<(String, String)>, String> {
    match entry.get_password() {
        Ok(value) => serde_json::from_str(&value).map(Some).map_err(|_| "Saved T3 pairing is invalid. Pair again.".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not restore T3 pairing: {e}")),
    }
}

pub fn forget_pairing() -> Result<(), String> {
    forget_pairing_from(&credential()?)
}

fn forget_pairing_from(entry: &keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not forget T3 pairing: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_history_survives_reload_and_replacement() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_repositories(dir.path()).unwrap(), None);
        let repos = vec!["D:/source/My project".into(), "D:/source/Other".into()];
        save_repositories(dir.path(), &repos).unwrap();
        assert_eq!(load_repositories(dir.path()).unwrap(), Some(repos));
        save_repositories(dir.path(), &[]).unwrap();
        assert_eq!(load_repositories(dir.path()).unwrap(), Some(vec![]));
        fs::write(dir.path().join("repositories.json"), "invalid").unwrap();
        assert!(load_repositories(dir.path()).is_err());
    }

    #[test]
    fn favorites_survive_reload_without_changing_recent_repositories() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_favorites(dir.path()).unwrap(), None);
        let recent = vec!["D:/source/Recent".into()];
        save_repositories(dir.path(), &recent).unwrap();
        let favorites: Vec<String> = (0..15).map(|i| format!("D:/source/Favorite{i}")).collect();
        save_favorites(dir.path(), &favorites).unwrap();
        assert_eq!(load_favorites(dir.path()).unwrap(), Some(favorites.clone()));
        assert_eq!(load_repositories(dir.path()).unwrap(), Some(recent));
        let duplicates = vec![favorites[0].clone(), favorites[0].clone()];
        save_favorites(dir.path(), &duplicates).unwrap();
        assert_eq!(load_favorites(dir.path()).unwrap(), Some(vec![favorites[0].clone()]));
        save_favorites(dir.path(), &[]).unwrap();
        assert_eq!(load_favorites(dir.path()).unwrap(), Some(vec![]));
    }

    #[test]
    fn repository_display_names_survive_reload_and_reset() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_repository_names(dir.path()).unwrap().is_empty());
        let mut names = std::collections::HashMap::new();
        names.insert("d:/source/my repo".into(), "My project".into());
        save_repository_names(dir.path(), &names).unwrap();
        assert_eq!(load_repository_names(dir.path()).unwrap(), names);
        names.clear();
        save_repository_names(dir.path(), &names).unwrap();
        assert!(load_repository_names(dir.path()).unwrap().is_empty());
        fs::write(dir.path().join("repository-names.json"), "invalid").unwrap();
        assert!(load_repository_names(dir.path()).is_err());
    }

    #[test]
    fn pairing_survives_reload_and_explicit_disconnect() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        // The mock store keeps state on the entry, unlike the OS store.
        let entry = credential().unwrap();
        assert_eq!(load_pairing_from(&entry).unwrap(), None);
        let session = ("http://127.0.0.1:3773".into(), "test-token".into());
        save_pairing_to(&entry, &session).unwrap();
        assert_eq!(load_pairing_from(&entry).unwrap(), Some(session));
        forget_pairing_from(&entry).unwrap();
        assert_eq!(load_pairing_from(&entry).unwrap(), None);
        forget_pairing_from(&entry).unwrap();
        entry.set_password("invalid").unwrap();
        assert!(load_pairing_from(&entry).is_err());
    }
}
