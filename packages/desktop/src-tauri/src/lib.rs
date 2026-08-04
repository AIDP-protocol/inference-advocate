// Tauri application library: loopback RPC into the Node HostSession launcher.
//
// Paper: steps 1 and 12.
//
// The desktop launcher (packages/desktop/scripts/run-tauri.mjs) constructs HostSession
// in-process and listens with host-rpc.ts. This shell dials AIRP_HOST_ADDR and forwards
// UI invokes through the host_call command. Conversation content still does not leave
// through this shell; telemetry still cannot see the transcript key.
//
// Remaining honesty: HostSession still runs under Node in the launcher process, not inside
// this Rust binary. AIRP_DESKTOP=1 surfaces that packaging gap at startup.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent};

struct HostIpc {
    stream: TcpStream,
    reader: BufReader<TcpStream>,
    next_id: u64,
}

struct HostBridge(Mutex<HostIpc>);

fn host_endpoint() -> Result<String, String> {
    std::env::var("AIRP_HOST_ADDR").map_err(|_| {
        "AIRP_HOST_ADDR is unset. Start the desktop shell with npm run desktop so the Node launcher can construct HostSession and publish the loopback RPC endpoint.".to_string()
    })
}

fn connect_host_rpc() -> Result<HostIpc, String> {
    let endpoint = host_endpoint()?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut last_err = String::from("not attempted");

    let stream = loop {
        match TcpStream::connect(&endpoint) {
            Ok(s) => break s,
            Err(e) => {
                last_err = e.to_string();
                if Instant::now() >= deadline {
                    return Err(format!(
                        "could not connect to HostSession RPC at {endpoint}: {last_err}"
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    };

    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(|e| format!("rpc set_read_timeout: {e}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| format!("rpc set_write_timeout: {e}"))?;

    let reader_stream = stream
        .try_clone()
        .map_err(|e| format!("rpc clone stream: {e}"))?;
    let mut reader = BufReader::new(reader_stream);
    wait_for_ready(&mut reader, Duration::from_secs(30))?;

    Ok(HostIpc {
        stream,
        reader,
        next_id: 1,
    })
}

fn wait_for_ready(
    reader: &mut BufReader<TcpStream>,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut line = String::new();
    while Instant::now() < deadline {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                return Err("host RPC closed before ready".into());
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let msg: Value = serde_json::from_str(trimmed)
                    .map_err(|e| format!("rpc ready parse: {e}"))?;
                if msg.get("event").and_then(|e| e.as_str()) == Some("ready") {
                    return Ok(());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(format!("rpc ready read: {e}")),
        }
    }
    Err(format!(
        "HostSession RPC did not become ready within {timeout:?}"
    ))
}

impl HostIpc {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let req = json!({ "id": id, "method": method, "params": params });
        writeln!(self.stream, "{req}").map_err(|e| format!("rpc write: {e}"))?;
        self.stream
            .flush()
            .map_err(|e| format!("rpc flush: {e}"))?;

        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("rpc read: {e}"))?;
            if n == 0 {
                return Err("host RPC closed".into());
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let msg: Value =
                serde_json::from_str(trimmed).map_err(|e| format!("rpc response parse: {e}"))?;
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

fn shutdown_bridge(bridge: &HostBridge) {
    if let Ok(mut guard) = bridge.0.lock() {
        let _ = guard.stream.shutdown(std::net::Shutdown::Both);
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
            .map_err(|_| "host RPC lock poisoned".to_string())?
            .call(&method, params)
    })
    .await
    .map_err(|e| format!("rpc join: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ipc = connect_host_rpc().unwrap_or_else(|e| {
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
                    shutdown_bridge(&bridge);
                }
            }
        });
}
