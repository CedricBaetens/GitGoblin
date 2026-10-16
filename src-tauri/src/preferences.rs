use std::{fs, io::Write, path::Path};

pub fn load_repositories(directory: &Path) -> Result<Option<Vec<String>>, String> {
    match fs::read(directory.join("repositories.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_repositories(directory: &Path, repositories: &[String]) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(repositories).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(directory.join("repositories.json")).map_err(|e| e.to_string())?;
    Ok(())
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
