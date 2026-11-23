// @Jin 本模块是 Tauri 与 ctb 命令行（sidecar 运行时）之间的桥接层：
// 负责定位 ctb-runtime 目录、注入 GDAL_DATA、拉起子进程并把 stdout/stderr
// 实时回传到前端日志窗口，同时支持任务取消。

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};

const CTB_TOOLS: [&str; 4] = ["ctb-tile", "ctb-info", "ctb-export", "ctb-extents"];

/// @Jin 运行中的子进程表，job_id -> Child，用于取消任务
#[derive(Default)]
struct JobState {
    jobs: HashMap<String, Child>,
}

#[derive(Serialize, Clone)]
struct RuntimeInfo {
    runtime_dir: String,
    gdal_data: String,
    custom_path: Option<String>,
    tools: Vec<ToolStatus>,
}

#[derive(Serialize, Clone)]
struct ToolStatus {
    name: String,
    exe: String,
    exists: bool,
}

#[derive(Serialize, Clone)]
struct LogPayload {
    job_id: String,
    stream: String,
    text: String,
}

#[derive(Serialize, Clone)]
struct FinishPayload {
    job_id: String,
    success: bool,
    code: Option<i32>,
}

/// @Jin 用户设置（当前仅含自定义 ctb 运行时目录），落盘到 app 配置目录
// @Jin 同时需要 Serialize（保存设置）与 Deserialize（读取设置）
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Settings {
    runtime_path: Option<String>,
}

fn settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("settings.json"))
}

fn load_settings(app: &tauri::AppHandle) -> Settings {
    let Some(path) = settings_path(app) else {
        return Settings::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("无法解析配置目录")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// @Jin 按优先级解析 ctb 运行时目录：
/// 1. 用户在设置页指定的自定义目录；
/// 2. 绿色版：exe 同级的 ctb-runtime 目录（拷贝到任意机器均生效）；
/// 3. 安装包 resources 内的 ctb-runtime；
/// 4. 开发期回退到源码工作区 tools/ctb-cesium-jin 与 src-tauri/resources。
fn resolve_runtime_dir(app: &tauri::AppHandle) -> PathBuf {
    let settings = load_settings(app);
    if let Some(custom) = settings.runtime_path {
        let path = PathBuf::from(custom);
        if path.join(tool_exe_name("ctb-tile")).exists() {
            return path;
        }
    }

    // @Jin 绿色版优先：以可执行文件所在目录为锚点，不依赖安装路径与开发机目录
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let portable = exe_dir.join("ctb-runtime");
            if portable.join(tool_exe_name("ctb-tile")).exists() {
                return portable;
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("ctb-runtime");
        if bundled.join(tool_exe_name("ctb-tile")).exists() {
            return bundled;
        }
        // @Jin 兼容 resources 数组写法：部分 Tauri 版本会保留 resources/ 前缀目录
        let prefixed = resource_dir.join("resources/ctb-runtime");
        if prefixed.join(tool_exe_name("ctb-tile")).exists() {
            return prefixed;
        }
    }

    let dev_candidates = [
        PathBuf::from(r"E:\terrain\ctb\tools\ctb-cesium-jin"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ctb-runtime"),
    ];
    for candidate in dev_candidates {
        if candidate.join(tool_exe_name("ctb-tile")).exists() {
            return candidate;
        }
    }

    // @Jin 全部未命中时仍返回资源目录，前端会据此提示用户在设置页指定路径
    app.path()
        .resource_dir()
        .map(|dir| dir.join("ctb-runtime"))
        .unwrap_or_else(|_| PathBuf::from("ctb-runtime"))
}

/// @Jin Windows 下可执行文件需要 .exe 后缀，其它平台保持原样
fn tool_exe_name(tool: &str) -> String {
    if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> RuntimeInfo {
    let settings = load_settings(&app);
    let runtime_dir = resolve_runtime_dir(&app);
    let tools = CTB_TOOLS
        .iter()
        .map(|name| {
            let exe = tool_exe_name(name);
            let exists = runtime_dir.join(&exe).exists();
            ToolStatus {
                name: (*name).to_string(),
                exe,
                exists,
            }
        })
        .collect();

    RuntimeInfo {
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        gdal_data: runtime_dir
            .join("gdaldata")
            .to_string_lossy()
            .to_string(),
        custom_path: settings.runtime_path,
        tools,
    }
}

#[tauri::command]
fn set_runtime_path(
    app: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<JobState>>>,
    path: String,
) -> Result<RuntimeInfo, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err("指定的目录不存在".into());
    }
    if !dir.join(tool_exe_name("ctb-tile")).exists() {
        return Err("该目录下未找到 ctb-tile.exe，请选择 ctb 工具运行时目录".into());
    }
    save_settings(&app, &Settings {
        runtime_path: Some(path),
    })?;
    // @Jin 运行中任务不允许切换运行时，避免新任务与旧任务使用不同二进制
    if !state.lock().unwrap().jobs.is_empty() {
        return Err("有任务正在运行，请等待结束或取消后再切换目录".into());
    }
    Ok(get_runtime_info(app))
}

#[tauri::command]
fn run_job(
    app: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<JobState>>>,
    job_id: String,
    tool: String,
    args: Vec<String>,
) -> Result<(), String> {
    if !CTB_TOOLS.contains(&tool.as_str()) {
        return Err(format!("不支持的工具：{tool}"));
    }

    let runtime_dir = resolve_runtime_dir(&app);
    let exe_path = runtime_dir.join(tool_exe_name(&tool));
    if !exe_path.exists() {
        return Err(format!("未找到可执行文件：{}", exe_path.display()));
    }

    // @Jin ctb 依赖同目录的 ctb.dll/gdal202.dll/zlib.dll，因此 cwd 必须锁定运行时目录
    let mut command = Command::new(&exe_path);
    command
        .args(&args)
        .current_dir(&runtime_dir)
        .env("GDAL_DATA", runtime_dir.join("gdaldata"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!(
            "启动 {} 失败：{e}（请确认运行时目录内 DLL 与 gdaldata 完整）",
            exe_path.display()
        )
    })?;

    // @Jin 分别接管 stdout/stderr，逐行通过 Tauri 事件推送到前端控制台
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let job_clone = job_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_clone.emit(
                    "ctb-log",
                    LogPayload {
                        job_id: job_clone.clone(),
                        stream: "stdout".into(),
                        text: line,
                    },
                );
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let job_clone = job_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_clone.emit(
                    "ctb-log",
                    LogPayload {
                        job_id: job_clone.clone(),
                        stream: "stderr".into(),
                        text: line,
                    },
                );
            }
        });
    }

    state.lock().unwrap().jobs.insert(job_id.clone(), child);

    // @Jin 等待线程：回收退出码后通知前端，并清理 jobs 表
    let app_wait = app.clone();
    // @Jin 克隆 Arc 句柄移交给等待线程，避免借用 State 跨越线程生命周期
    let state_wait = state.inner().clone();
    let job_wait = job_id.clone();
    std::thread::spawn(move || {
        let status = {
            let mut guard = state_wait.lock().unwrap();
            let Some(child) = guard.jobs.get_mut(&job_wait) else {
                return;
            };
            child.wait()
        };
        state_wait.lock().unwrap().jobs.remove(&job_wait);

        let payload = match status {
            Ok(exit) => FinishPayload {
                job_id: job_wait.clone(),
                success: exit.success(),
                code: exit.code(),
            },
            Err(err) => {
                let _ = app_wait.emit(
                    "ctb-log",
                    LogPayload {
                        job_id: job_wait.clone(),
                        stream: "stderr".into(),
                        text: format!("进程等待失败：{err}"),
                    },
                );
                FinishPayload {
                    job_id: job_wait.clone(),
                    success: false,
                    code: None,
                }
            }
        };
        let _ = app_wait.emit("ctb-finish", payload);
    });

    Ok(())
}

#[tauri::command]
fn cancel_job(
    app: tauri::AppHandle,
    state: tauri::State<Arc<Mutex<JobState>>>,
    job_id: String,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let Some(child) = guard.jobs.get_mut(&job_id) else {
        return Err("没有找到对应的运行任务".into());
    };
    // @Jin Windows 下 kill 直接终止 ctb 进程树中的主进程
    child.kill().map_err(|e| e.to_string())?;
    let _ = app.emit(
        "ctb-log",
        LogPayload {
            job_id,
            stream: "stderr".into(),
            text: "用户已取消任务，进程被终止".into(),
        },
    );
    Ok(())
}

#[tauri::command]
fn is_running(state: tauri::State<Arc<Mutex<JobState>>>) -> bool {
    !state.lock().unwrap().jobs.is_empty()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(JobState::default())))
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            set_runtime_path,
            run_job,
            cancel_job,
            is_running
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
