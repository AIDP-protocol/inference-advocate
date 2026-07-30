// Desktop shell entry. Spawns the Node daemon as a loopback sidecar, then loads it in a window.
//
// Paper: steps 1 and 12. PLAN: desktop packaging.
//
// This is the first slice, not the finished shape. The architectural target is an in-process
// (or IPC) call from the shell into HostSession, retiring the HTTP listener. Until that lands,
// AIDP_DESKTOP=1 makes the advocate say so at startup.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    inference_advocate_lib::run();
}
