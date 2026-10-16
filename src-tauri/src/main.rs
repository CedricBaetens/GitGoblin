#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;
mod preferences;
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};
use tauri::{Manager, State};

#[derive(Default)]
struct AppState {
    git_lock: Arc<RwLock<()>>,
    t3: Mutex<Option<(String, String)>>,
}

#[tauri::command]
async fn git_request(request: git::Request, state: State<'_, AppState>) -> Result<Value, String> {
    // Reads can run together; mutations still exclude every other Git operation.
    let lock = state.git_lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let action = request.action.clone();
        with_git_access(&lock, &action, || git::execute(request))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn with_git_access<T>(lock: &RwLock<()>, action: &str, run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    if git::is_read_only(action) {
        let _guard = lock.read().map_err(|e| e.to_string())?;
        run()
    } else {
        let _guard = lock.write().map_err(|e| e.to_string())?;
        run()
    }
}

#[cfg(test)]
mod access_tests {
    use super::*;
    #[test]
    fn diffs_do_not_queue_behind_reads_but_mutations_stay_exclusive() {
        let lock = Arc::new(RwLock::new(()));
        let background = lock.read().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let other = lock.clone();
        let reader = std::thread::spawn(move || with_git_access(&other, "diff", || {
            sender.send(()).unwrap(); Ok(())
        }));
        let concurrent = receiver.recv_timeout(Duration::from_secs(1));
        drop(background);
        reader.join().unwrap().unwrap();
        assert!(concurrent.is_ok(), "File diff waited behind a background read");

        let background = lock.read().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let other = lock.clone();
        let writer = std::thread::spawn(move || with_git_access(&other, "stage", || {
            sender.send(()).unwrap(); Ok(())
        }));
        let premature = receiver.recv_timeout(Duration::from_millis(50));
        drop(background);
        assert!(premature.is_err(), "Mutation overlapped a read");
        receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        writer.join().unwrap().unwrap();
        assert!(!git::is_read_only("unknown-action"));
    }
}

fn local_origin(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Enter a valid local T3 address.")?;
    if !["http", "https"].contains(&url.scheme())
        || !["localhost", "127.0.0.1", "[::1]"].contains(&url.host_str().unwrap_or(""))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only a T3 server on this machine is supported.".into());
    }
    Ok(url.origin().ascii_serialization())
}
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "T3 returned HTTP {}. Check the pairing code, server version, and granted permissions.",
            response.status()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "T3 returned an unexpected response.".into())
}

#[tauri::command]
fn t3_discover() -> Option<String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let value: Value = serde_json::from_slice(
        &std::fs::read(std::path::Path::new(&home).join(".t3/userdata/server-runtime.json"))
            .ok()?,
    )
    .ok()?;
    let port = value.get("port")?.as_u64()?;
    if port == 0 || port > 65535 {
        return None;
    }
    Some(format!("http://127.0.0.1:{port}"))
}

#[tauri::command]
async fn t3_pair(
    origin: String,
    credential: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let origin = local_origin(&origin)?;
    let body = [
        (
            "grant_type",
            "urn:ietf:params:oauth:grant-type:token-exchange",
        ),
        ("subject_token", credential.as_str()),
        (
            "subject_token_type",
            "urn:t3:params:oauth:token-type:environment-bootstrap",
        ),
        (
            "requested_token_type",
            "urn:ietf:params:oauth:token-type:access_token",
        ),
        ("scope", "orchestration:read orchestration:operate"),
        ("client_label", "GitGoblin"),
        ("client_device_type", "desktop"),
    ];
    let result = response_json(
        http()?
            .post(format!("{origin}/oauth/token"))
            .form(&body)
            .send()
            .await
            .map_err(|_| "Could not reach the local T3 server.")?,
    )
    .await?;
    let token = result
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("T3 did not return an access token.")?
        .to_string();
    let mut session = state.t3.lock().map_err(|e| e.to_string())?;
    preferences::save_pairing(&(origin.clone(), token.clone()))?;
    *session = Some((origin, token));
    Ok(json!({"connected":true,"expiresIn":result.get("expires_in"),"scope":result.get("scope")}))
}

#[tauri::command]
async fn t3_ticket(state: State<'_, AppState>) -> Result<String, String> {
    let (origin, token) = state
        .t3
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Pair with T3 Code first.")?;
    let result = response_json(
        http()?
            .post(format!("{origin}/api/auth/websocket-ticket"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|_| "Could not reach the local T3 server.")?,
    )
    .await?;
    let ticket = result
        .get("ticket")
        .and_then(Value::as_str)
        .ok_or("T3 did not return a connection ticket.")?;
    let mut url = reqwest::Url::parse(&origin).map_err(|e| e.to_string())?;
    url.set_scheme(if origin.starts_with("https:") {
        "wss"
    } else {
        "ws"
    })
    .map_err(|_| "Invalid socket scheme")?;
    url.set_path("/ws");
    url.query_pairs_mut()
        .append_pair("wsTicket", ticket)
        .append_pair("orchestrationProtocol", "2")
        .append_pair("clientSurface", "web")
        .append_pair("clientDeviceType", "desktop")
        .append_pair("connectionMethod", "direct");
    Ok(url.into())
}

#[tauri::command]
fn t3_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut session = state.t3.lock().map_err(|e| e.to_string())?;
    preferences::forget_pairing()?;
    *session = None;
    Ok(())
}

#[tauri::command]
fn t3_restore(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut session = state.t3.lock().map_err(|e| e.to_string())?;
    if session.is_none() {
        if let Some((origin, token)) = preferences::load_pairing()? {
            *session = Some((local_origin(&origin)?, token));
        }
    }
    Ok(session.as_ref().map(|(origin, _)| origin.clone()))
}

#[tauri::command]
fn repositories_load(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    preferences::load_repositories(&app.path().app_data_dir().map_err(|e| e.to_string())?)
}

#[tauri::command]
fn repositories_save(app: tauri::AppHandle, repositories: Vec<String>) -> Result<(), String> {
    preferences::save_repositories(&app.path().app_data_dir().map_err(|e| e.to_string())?, &repositories)
}

#[tauri::command]
fn open_editor(repo: String, path: String) -> Result<(), String> {
    let root = std::fs::canonicalize(repo).map_err(|e| e.to_string())?;
    let target = std::fs::canonicalize(root.join(path)).map_err(|e| e.to_string())?;
    if !target.starts_with(root) {
        return Err("File must be within the worktree.".into());
    }
    // Launch an editor executable directly, never a user-controlled shell command.
    #[cfg(windows)]
    let editor =
        std::path::PathBuf::from(std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?)
            .join("Programs/Microsoft VS Code/Code.exe");
    #[cfg(not(windows))]
    let editor = std::path::PathBuf::from("code");
    let mut command = std::process::Command::new(editor);
    command.arg("--reuse-window").arg(target);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|e| {
        format!("Could not open VS Code. Ensure its 'code' launcher is on PATH: {e}")
    })?;
    Ok(())
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    #[cfg(debug_assertions)]
    if args.get(1).map(String::as_str) == Some("--git-request") {
        // Exercise the exact native command boundary on disposable repositories.
        use std::io::Read;
        let mut input = String::new();
        let result = std::io::stdin()
            .read_to_string(&mut input)
            .map_err(|e| e.to_string())
            .and_then(|_| serde_json::from_str::<git::Request>(&input).map_err(|e| e.to_string()))
            .and_then(git::execute);
        match result {
            Ok(value) => println!("{}", json!({"ok":value})),
            Err(error) => {
                println!("{}", json!({"error":error}));
                std::process::exit(1)
            }
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("--sequence-editor") {
        let result = args
            .get(2)
            .zip(args.get(3))
            .ok_or("Missing sequence editor paths")
            .and_then(|(source, destination)| {
                std::fs::copy(source, destination)
                    .map(|_| ())
                    .map_err(|_| "Cannot write rebase plan")
            });
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            git_request,
            t3_discover,
            t3_pair,
            t3_ticket,
            t3_disconnect,
            t3_restore,
            repositories_load,
            repositories_save,
            open_editor
        ])
        .run(tauri::generate_context!())
        .expect("Could not start GitGoblin");
}
