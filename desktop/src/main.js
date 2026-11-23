// @Jin 前端主控：表单 -> ctb 命令参数拼装 -> Tauri invoke 调 Rust sidecar 桥接层
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

const $ = (id) => document.getElementById(id);

// @Jin 运行状态：同一时间只允许一个切片任务，避免 GDAL 写目录互相干扰
let currentJobId = null;

const PANELS = ["tile", "info", "export", "extents", "settings"];

/* ---------------- 工具函数 ---------------- */

// @Jin Windows 参数转义：路径含空格时用双引号包裹，并转义内部引号
function quoteArg(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/[\s"]/.test(text)) {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return text;
}

function val(id) {
  return $(id).value.trim();
}

function checked(id) {
  return $(id).checked;
}

function pushArg(args, preview, flag, value) {
  if (value === "" || value === null || value === undefined) return;
  args.push(flag, String(value));
  preview.push(flag, quoteArg(value));
}

function pushFlag(args, preview, flag, on) {
  if (!on) return;
  args.push(flag);
  preview.push(flag);
}

function logLine(text, cls = "") {
  const box = $("console");
  const span = document.createElement("div");
  if (cls) span.className = cls;
  span.textContent = text;
  box.appendChild(span);
  if ($("console-autoscroll").checked) {
    box.scrollTop = box.scrollHeight;
  }
}

function setRunning(running) {
  $("btn-run").disabled = running;
  $("btn-cancel").classList.toggle("hidden", !running);
}

/* ---------------- 面板切换 ---------------- */

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.panel;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b === btn));
    PANELS.forEach((name) => {
      $(`panel-${name}`).classList.toggle("active", name === target);
    });
    refreshPreview();
  });
});

/* ---------------- 文件对话框 ---------------- */

document.querySelectorAll(".btn-browse").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = $(btn.dataset.pick);
    const kind = btn.dataset.kind;
    let selected = null;
    if (kind === "dir") {
      selected = await open({ directory: true, multiple: false });
    } else if (kind === "save") {
      selected = await save({ defaultPath: target.value || undefined });
    } else {
      selected = await open({ multiple: false });
    }
    if (typeof selected === "string") {
      target.value = selected;
      persistForm();
      refreshPreview();
    }
  });
});

/* ---------------- 命令构建 ---------------- */

function activePanel() {
  return PANELS.find((name) => $(`panel-${name}`).classList.contains("active"));
}

// @Jin 返回 { tool, args, preview, missing }，args 为传给 Rust 的干净参数，preview 为展示串
function buildCommand() {
  const panel = activePanel();
  const args = [];
  const preview = [];
  const missing = [];

  if (panel === "tile") {
    const input = val("tile-input");
    const output = val("tile-output");
    if (!input) missing.push("输入栅格");
    if (!output) missing.push("输出目录");

    pushArg(args, preview, "-o", output);

    const formatSelect = val("tile-format");
    if (formatSelect === "__custom__") {
      pushArg(args, preview, "-f", val("tile-format-custom"));
    } else {
      pushArg(args, preview, "-f", formatSelect);
    }
    pushArg(args, preview, "-p", val("tile-profile"));
    pushArg(args, preview, "-c", val("tile-threads"));
    pushArg(args, preview, "-t", val("tile-size"));
    pushArg(args, preview, "-s", val("tile-start"));
    pushArg(args, preview, "-e", val("tile-end"));
    pushArg(args, preview, "-r", val("tile-resample"));
    pushArg(args, preview, "-z", val("tile-error"));
    pushArg(args, preview, "-m", val("tile-warp"));
    pushArg(args, preview, "-g", val("tile-qfactor"));

    // @Jin 创建选项支持多行，每行一条，逐个追加 -n
    val("tile-creation")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((option) => pushArg(args, preview, "-n", option));

    pushFlag(args, preview, "-R", checked("tile-resume"));
    pushFlag(args, preview, "-l", checked("tile-layer"));
    pushFlag(args, preview, "-C", checked("tile-cesium"));
    pushFlag(args, preview, "-N", checked("tile-normals"));
    pushFlag(args, preview, "-q", checked("tile-quiet"));
    pushFlag(args, preview, "-v", checked("tile-verbose"));

    args.push(input);
    preview.push(quoteArg(input));
    return { tool: "ctb-tile", args, preview, missing };
  }

  if (panel === "info") {
    const input = val("info-input");
    if (!input) missing.push("瓦片文件");
    pushFlag(args, preview, "-e", checked("info-heights"));
    pushFlag(args, preview, "-c", checked("info-nochild"));
    pushFlag(args, preview, "-t", checked("info-notype"));
    args.push(input);
    preview.push(quoteArg(input));
    return { tool: "ctb-info", args, preview, missing };
  }

  if (panel === "export") {
    const input = val("export-input");
    const zoom = val("export-zoom");
    const tileX = val("export-x");
    const tileY = val("export-y");
    const output = val("export-output");
    if (!input) missing.push("输入瓦片");
    if (!zoom) missing.push("层级");
    if (!tileX) missing.push("瓦片 X");
    if (!tileY) missing.push("瓦片 Y");
    if (!output) missing.push("输出文件");
    pushArg(args, preview, "-i", input);
    pushArg(args, preview, "-z", zoom);
    pushArg(args, preview, "-x", tileX);
    pushArg(args, preview, "-y", tileY);
    pushArg(args, preview, "-o", output);
    return { tool: "ctb-export", args, preview, missing };
  }

  if (panel === "extents") {
    const input = val("ext-input");
    if (!input) missing.push("输入栅格");
    pushArg(args, preview, "-o", val("ext-output"));
    pushArg(args, preview, "-p", val("ext-profile"));
    pushArg(args, preview, "-t", val("ext-size"));
    pushArg(args, preview, "-s", val("ext-start"));
    pushArg(args, preview, "-e", val("ext-end"));
    args.push(input);
    preview.push(quoteArg(input));
    return { tool: "ctb-extents", args, preview, missing };
  }

  return { tool: null, args, preview, missing: ["当前为设置页"] };
}

function refreshPreview() {
  const { tool, preview, missing } = buildCommand();
  const box = $("command-text");
  if (!tool) {
    box.textContent = "设置页无命令";
    return;
  }
  if (missing.length) {
    box.textContent = `待填必填项：${missing.join("、")}`;
    return;
  }
  box.textContent = [tool, ...preview].join(" ");
}

/* ---------------- 表单持久化 ---------------- */

const FORM_IDS = [
  "tile-input", "tile-output", "tile-format", "tile-format-custom", "tile-profile",
  "tile-start", "tile-end", "tile-resample", "tile-threads", "tile-size",
  "tile-qfactor", "tile-error", "tile-warp", "tile-creation",
  "tile-layer", "tile-cesium", "tile-resume", "tile-normals", "tile-quiet", "tile-verbose",
  "info-input", "info-heights", "info-nochild", "info-notype",
  "export-input", "export-zoom", "export-x", "export-y", "export-output",
  "ext-input", "ext-output", "ext-profile", "ext-size", "ext-start", "ext-end",
];

function persistForm() {
  const data = {};
  FORM_IDS.forEach((id) => {
    const el = $(id);
    data[id] = el.type === "checkbox" ? el.checked : el.value;
  });
  localStorage.setItem("ctb-desktop-form", JSON.stringify(data));
}

function restoreForm() {
  const raw = localStorage.getItem("ctb-desktop-form");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    FORM_IDS.forEach((id) => {
      if (!(id in data)) return;
      const el = $(id);
      if (el.type === "checkbox") el.checked = Boolean(data[id]);
      else el.value = data[id];
    });
  } catch (err) {
    console.warn("表单恢复失败", err);
  }
}

document.querySelectorAll("input, select, textarea").forEach((el) => {
  el.addEventListener("input", () => {
    persistForm();
    refreshPreview();
  });
  el.addEventListener("change", () => {
    persistForm();
    refreshPreview();
  });
});

$("tile-format").addEventListener("change", (e) => {
  $("tile-format-custom").classList.toggle("hidden", e.target.value !== "__custom__");
});

/* ---------------- 任务执行 ---------------- */

$("btn-run").addEventListener("click", async () => {
  const { tool, args, preview, missing } = buildCommand();
  if (!tool) return;
  if (missing.length) {
    logLine(`[错误] 请先填写：${missing.join("、")}`, "log-stderr");
    return;
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  currentJobId = jobId;
  setRunning(true);
  logLine(`──────── 任务开始 ${new Date().toLocaleString()} ────────`, "log-system");
  logLine([tool, ...preview].join(" "), "log-system");

  try {
    await invoke("run_job", { jobId, tool, args });
  } catch (err) {
    logLine(`[启动失败] ${err}`, "log-stderr");
    currentJobId = null;
    setRunning(false);
  }
});

$("btn-cancel").addEventListener("click", async () => {
  if (!currentJobId) return;
  try {
    await invoke("cancel_job", { jobId: currentJobId });
  } catch (err) {
    logLine(`[取消失败] ${err}`, "log-stderr");
  }
});

$("btn-clear-log").addEventListener("click", () => {
  $("console").innerHTML = "";
});

$("btn-reset").addEventListener("click", () => {
  localStorage.removeItem("ctb-desktop-form");
  // @Jin 保留输出目录等使用习惯，仅重置当前面板，刷新页面是最稳妥的全量复位
  location.reload();
});

/* ---------------- Tauri 事件 ---------------- */

listen("ctb-log", (event) => {
  const payload = event.payload;
  if (currentJobId && payload.job_id !== currentJobId) return;
  logLine(payload.text, payload.stream === "stderr" ? "log-stderr" : "");
});

listen("ctb-finish", (event) => {
  const payload = event.payload;
  if (currentJobId && payload.job_id !== currentJobId) return;
  currentJobId = null;
  setRunning(false);
  if (payload.success) {
    logLine(`──────── 任务完成，退出码 ${payload.code ?? 0} ────────`, "log-success");
  } else {
    logLine(`──────── 任务失败，退出码 ${payload.code ?? "未知"} ────────`, "log-stderr");
  }
});

/* ---------------- 运行时信息 ---------------- */

async function refreshRuntime() {
  try {
    const info = await invoke("get_runtime_info");
    const allOk = info.tools.every((tool) => tool.exists);
    const badge = $("runtime-badge");
    badge.className = `runtime-badge ${allOk ? "runtime-ok" : "runtime-bad"}`;
    badge.textContent = allOk
      ? `运行时就绪：${info.tools.length} 个工具`
      : "运行时不完整，请到「运行时设置」检查";

    $("settings-runtime").value = info.custom_path || info.runtime_dir;
    const rows = info.tools
      .map((tool) => `${tool.exists ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>'} ${tool.name} → ${tool.exe}`)
      .join("<br>");
    $("runtime-card").innerHTML = `
      <div><b>运行时目录：</b>${info.runtime_dir}</div>
      <div><b>GDAL_DATA：</b>${info.gdal_data}</div>
      <div><b>自定义路径：</b>${info.custom_path || "未设置（使用内置/默认目录）"}</div>
      <div style="margin-top:6px">${rows}</div>
    `;
  } catch (err) {
    $("runtime-badge").className = "runtime-badge runtime-bad";
    $("runtime-badge").textContent = "运行时检测失败";
    logLine(`[运行时检测失败] ${err}`, "log-stderr");
  }
}

$("settings-save").addEventListener("click", async () => {
  try {
    const info = await invoke("set_runtime_path", { path: val("settings-runtime") });
    logLine(`[设置] 运行时目录已保存：${info.runtime_dir}`, "log-system");
    await refreshRuntime();
  } catch (err) {
    logLine(`[设置失败] ${err}`, "log-stderr");
  }
});

/* ---------------- 初始化 ---------------- */

restoreForm();
$("tile-format-custom").classList.toggle("hidden", val("tile-format") !== "__custom__");
refreshPreview();
refreshRuntime();
