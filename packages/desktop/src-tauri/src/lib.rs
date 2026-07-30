// Tauri application library: sidecar lifecycle for the local advocate daemon.
//
// Paper: steps 1 and 12.
//
// Binds privacy claims the same way the browser seam does: the Node process listens on
// 127.0.0.1 only. The window is chrome around that local surface. Conversation content still
// does not leave through this shell; telemetry still cannot see the transcript key.

use std::io::Read;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::RunEvent;

struct DaemonChild(Mutex<Option<Child>>);

fn repo_root() -> PathBuf {
    if let Ok(root) = std::env::var("AIDP_REPO_ROOT") {
        return PathBuf::from(root);
    }
    // Dev default: packages/desktop/src-tauri -> repo root is ../../..
    let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..6 {
        if dir.join("packages").join("daemon").join("dist").join("server.js").is_file() {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    panic!(
        "could not find the repository root (set AIDP_REPO_ROOT). Expected packages/daemon/dist/server.js"
    );
}

fn wait_for_loopback(port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let addr = format!("127.0.0.1:{port}");
    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect(&addr) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
            let req = format!(
                "GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
            );
            if std::io::Write::write_all(&mut stream, req.as_bytes()).is_ok() {
                let mut buf = [0u8; 64];
                if stream.read(&mut buf).is_ok() {
                    return Ok(());
                }
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!(
        "advocate sidecar did not become ready on {addr} within {timeout:?}"
    ))
}

fn spawn_daemon(port: u16) -> Result<Child, String> {
    let root = repo_root();
    let server = root.join("packages").join("daemon").join("dist").join("server.js");
    if !server.is_file() {
        return Err(format!(
            "missing {}; run npm run build from the repository root",
            server.display()
        ));
    }
    let node = std::env::var("AIDP_NODE").unwrap_or_else(|_| "node".to_string());
    Command::new(&node)
        .arg(&server)
        .current_dir(&root)
        .env("AIDP_DESKTOP", "1")
        .env("AIDP_PORT", port.to_string())
        .env("AIDP_REPO_ROOT", &root)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn {node} {}: {e}", server.display()))
}

fn kill_daemon(state: &DaemonChild) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port: u16 = std::env::var("AIDP_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8790);

    let child = spawn_daemon(port).unwrap_or_else(|e| {
        eprintln!("inference-advocate desktop: {e}");
        std::process::exit(1);
    });
    let state = DaemonChild(Mutex::new(Some(child)));

    if let Err(e) = wait_for_loopback(port, Duration::from_secs(30)) {
        kill_daemon(&state);
        eprintln!("inference-advocate desktop: {e}");
        std::process::exit(1);
    }

    tauri::Builder::default()
        .manage(state)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(daemon) = app_handle.try_state::<DaemonChild>() {
                    kill_daemon(&daemon);
                }
            }
        });
}
