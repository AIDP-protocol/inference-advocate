// Tauri application library: stdio IPC into the Node HostSession host.
//
// Paper: steps 1 and 12.
//
// Spawns packages/daemon/dist/ipc-host.js (no HTTP listener). The webview loads the built UI
// from disk and calls HostSession through the host_call command. Conversation content still
// does not leave through this shell; telemetry still cannot see the transcript key.
//
// Remaining honesty: HostSession still runs in a Node child process, not inside the Rust
// binary. AIDP_DESKTOP=1 surfaces that packaging gap at startup.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent};

struct HostIpc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    next_id: u64,
}

struct HostBridge(Mutex<HostIpc>);

fn repo_root() -> PathBuf {
    if let Ok(root) = std::env::var("AIDP_REPO_ROOT") {
        return PathBuf::from(root);
    }
    // Dev default: packages/desktop/src-tauri -> repo root is ../../..
    let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..6 {
        if dir
            .join("packages")
            .join("daemon")
            .join("dist")
            .join("ipc-host.js")
            .is_file()
        {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    panic!(
        "could not find the repository root (set AIDP_REPO_ROOT). Expected packages/daemon/dist/ipc-host.js"
    );
}

fn spawn_ipc_host() -> Result<HostIpc, String> {
    let root = repo_root();
    let entry = root
        .join("packages")
        .join("daemon")
        .join("dist")
        .join("ipc-host.js");
    if !entry.is_file() {
        return Err(format!(
            "missing {}; run npm run build from the repository root",
            entry.display()
        ));
    }
    let node = std::env::var("AIDP_NODE").unwrap_or_else(|_| "node".to_string());
    let mut child = Command::new(&node)
        .arg(&entry)
        .current_dir(&root)
        .env("AIDP_DESKTOP", "1")
        .env("AIDP_REPO_ROOT", &root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn {node} {}: {e}", entry.display()))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "ipc host stdin missing".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "ipc host stdout missing".to_string())?;
    let mut stdout = BufReader::new(stdout);

    wait_for_ready(&mut stdout, Duration::from_secs(30))?;

    Ok(HostIpc {
        child,
        stdin,
        stdout,
        next_id: 1,
    })
}

fn wait_for_ready(
    stdout: &mut BufReader<std::process::ChildStdout>,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut line = String::new();
    while Instant::now() < deadline {
        line.clear();
        match stdout.read_line(&mut line) {
            Ok(0) => {
                return Err("ipc host exited before ready".into());
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let msg: Value = serde_json::from_str(trimmed)
                    .map_err(|e| format!("ipc ready parse: {e}"))?;
                if msg.get("event").and_then(|e| e.as_str()) == Some("ready") {
                    return Ok(());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(format!("ipc ready read: {e}")),
        }
    }
    Err(format!(
        "advocate IPC host did not become ready within {timeout:?}"
    ))
}

impl HostIpc {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let req = json!({ "id": id, "method": method, "params": params });
        writeln!(self.stdin, "{req}").map_err(|e| format!("ipc write: {e}"))?;
        self.stdin
            .flush()
            .map_err(|e| format!("ipc flush: {e}"))?;

        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("ipc read: {e}"))?;
            if n == 0 {
                return Err("ipc host closed stdout".into());
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let msg: Value =
                serde_json::from_str(trimmed).map_err(|e| format!("ipc response parse: {e}"))?;
            let msg_id = msg.get("id").and_then(|v| {
                v.as_u64()
                    .or_else(|| v.as_i64().map(|i| i as u64))
                    .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
            });
            if msg_id != Some(id) {
                continue;
            }
            if msg.get("ok").and_then(|o| o.as_bool()) == Some(true) {
                return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
            }
            let err = msg
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("host error");
            return Err(err.to_string());
        }
    }
}

fn kill_ipc(bridge: &HostBridge) {
    if let Ok(mut guard) = bridge.0.lock() {
        let _ = guard.child.kill();
        let _ = guard.child.wait();
    }
}

#[tauri::command]
async fn host_call(
    app: AppHandle,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let params = params.unwrap_or_else(|| json!({}));
    tauri::async_runtime::spawn_blocking(move || {
        let bridge = app.state::<HostBridge>();
        bridge
            .0
            .lock()
            .map_err(|_| "ipc host lock poisoned".to_string())?
            .call(&method, params)
    })
    .await
    .map_err(|e| format!("ipc join: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ipc = spawn_ipc_host().unwrap_or_else(|e| {
        eprintln!("inference-advocate desktop: {e}");
        std::process::exit(1);
    });
    let bridge = HostBridge(Mutex::new(ipc));

    tauri::Builder::default()
        .manage(bridge)
        .invoke_handler(tauri::generate_handler![host_call])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(bridge) = app_handle.try_state::<HostBridge>() {
                    kill_ipc(&bridge);
                }
            }
        });
}
