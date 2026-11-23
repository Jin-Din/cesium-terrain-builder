// @Jin 发布版隐藏控制台窗口，调试版保留以便观察 panic 信息
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ctb_desktop_lib::run()
}
