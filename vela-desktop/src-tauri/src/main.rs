// © 2025-present Rui Quintino. Vela Slides — licensed under ELv2. See LICENSE.
//! Vela Desktop — Tauri v2 backend entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vela_desktop_lib::run();
}
