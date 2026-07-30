// Desktop shell entry. Spawns the Node HostSession IPC host, then loads the UI in a window.
//
// Paper: steps 1 and 12.
//
// Advocate operations go through Tauri commands over stdio IPC into HostSession. There is no
// HTTP listener for the core API. AIDP_DESKTOP=1 reports that HostSession still lives in a
// Node child process rather than inside this binary.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    inference_advocate_lib::run();
}
