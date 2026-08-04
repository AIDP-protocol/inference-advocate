// Desktop shell entry. Connects to HostSession over loopback RPC, then loads the UI.
//
// Paper: steps 1 and 12.
//
// Advocate operations go through Tauri commands into a HostSession that the Node launcher
// constructed in-process. There is no HTTP listener for the core API, and no Node stdio
// child. AIRP_DESKTOP=1 reports that HostSession still lives under Node rather than inside
// this binary.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    inference_advocate_lib::run();
}
