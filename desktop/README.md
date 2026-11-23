# CTB 地形切片桌面端（ctb-desktop）

基于 **Tauri v2 + sidecar 思路** 开发的 Windows 桌面程序，把 Cesium Terrain Builder
的四个命令行工具（`ctb-tile`、`ctb-info`、`ctb-export`、`ctb-extents`）包装为
图形界面：命令参数全部变成表单选项，实时生成命令预览，执行过程流式输出日志，
支持任务取消与运行时目录切换。

## 架构说明

- 前端：原生 HTML / CSS / JavaScript + Vite，不引入重型框架。
- 后端：Rust（Tauri v2），通过 `std::process::Command` 拉起 ctb 可执行文件，
  等价于 sidecar 调用；子进程标准输出/错误经 Tauri 事件（`ctb-log` / `ctb-finish`）推送到界面。
- 运行时：ctb 的 exe、依赖 DLL（`ctb.dll`、`gdal202.dll`、`zlib.dll`）与 `gdaldata`
  统一放在 `src-tauri/resources/ctb-runtime/`，打包后随安装包分发；
  启动时自动注入 `GDAL_DATA` 并把工作目录锁定到运行时目录，保证 DLL 正确加载。
- 运行时目录解析优先级：设置页自定义路径 → exe 同级 `ctb-runtime`（绿色版锚点）→ 安装包内置 `ctb-runtime` → 开发期工作区回退目录。
- @Jin 中文路径兼容：GDAL 2.2（`gdal202.dll`）无法打开含非 ASCII 字符的 `GDAL_DATA`
  路径，检测到非 ASCII 运行时路径时自动把 `gdaldata` 部署到
  `C:\ProgramData\ctb-desktop\gdaldata`（带 `.gdaldata-deployed` 标记，仅部署一次；
  `LOCALAPPDATA` 为回退），再把该纯英文路径注入子进程环境变量。

## 目录结构

```
ctb-desktop/
├─ index.html                  # 四个工具的表单界面
├─ src/
│  ├─ main.js                  # 参数拼装、命令预览、事件日志、任务控制
│  └─ styles.css               # 桌面端样式
├─ scripts/
│  └─ prepare-runtime.ps1      # 从 tools 目录同步 ctb 运行时到 resources
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json          # 打包配置，resources 声明 ctb-runtime
   ├─ capabilities/default.json
   ├─ icons/
   ├─ resources/ctb-runtime/   # git 忽略，由 prepare-runtime.ps1 生成
   └─ src/
      ├─ main.rs
      └─ lib.rs                # sidecar 桥接：进程调度、GDAL_DATA、日志事件、取消
```

## 开发环境

- Rust（stable，MSVC 工具链，rustup 安装）
- Node.js 22 + npm
- Visual Studio 2022 Build Tools（提供 MSVC `link.exe`）
- WebView2 运行时（Windows 11 自带）

## 开发与打包

```powershell
# 1. 同步 ctb 运行时（新克隆或 tools 目录更新后执行）
.\scripts\prepare-runtime.ps1
# 也可指定来源：
# .\scripts\prepare-runtime.ps1 -Source E:\terrain\ctb\tools\ctb-cesium-jin

# 2. 安装前端依赖
npm install

# 3. 生成图标（依据 src-tauri/icons/app-icon.png）
npm run tauri icon src-tauri/icons/app-icon.png

# 4. 开发调试（热更新界面）
npm run tauri dev

# 5. 打包 exe 安装包（NSIS / MSI，产物在 src-tauri/target/release/bundle）
npm run tauri build
```

## 绿色版（免安装）

绿色版不写注册表、不依赖安装路径，解压后保持 exe 与 `ctb-runtime` 同级，
拷贝到任意 Windows 机器双击即可运行：

```
CTB-Terrain-Tool/
├─ ctb-desktop.exe
└─ ctb-runtime/          # 4 个 ctb 工具 + ctb/gdal/zlib 依赖 DLL + gdaldata
```

- 程序启动优先探测 exe 同级 `ctb-runtime` 目录，找不到时才回退到安装包资源与开发目录。
- 解压目录含中文等非 ASCII 字符时，`gdaldata` 会在首次启动自动部署到 ProgramData
  下的纯英文路径（见「架构说明」的中文路径兼容），切片坐标系数据加载不受影响。

## 界面对应的命令参数

- `ctb-tile`：输入/输出、`-f` 格式、`-p` 剖面、`-s/-e` 层级、`-r` 重采样、
  `-c` 线程、`-t` 瓦片尺寸、`-g` 质量系数、`-z/-m` 变换参数、`-n` 创建选项，
  以及 `-l -C -R -N -q -v` 开关。
- `ctb-info`：`-e -c -t` 开关。
- `ctb-export`：`-i -z -x -y -o`。
- `ctb-extents`：`-o -p -t -s -e` 加位置参数。

表单内容自动持久化到浏览器本地存储，下次打开保留上次参数；
底部「命令预览」实时显示等价的完整命令行，可与教程中的手工命令对照。

## 备注

- 同一时间只允许运行一个任务，避免多个 ctb 进程写同一输出目录。
- 若运行时检测不通过，在「运行时设置」中选择 `tools/ctb-cesium-jin` 目录即可，配置持久化保存。
- ctb 运行时二进制不入库（体积大），统一由 `prepare-runtime.ps1` 从 `E:\terrain\ctb\tools` 同步。

## 网络受限时的打包排障

Tauri 首次打包需要从 GitHub 下载 NSIS 工具，代理网络下可能出现
`io: unexpected end of file` 或 TLS 握手失败。两种处理方式：

1. 给 git / 终端配置本机代理（Clash 默认端口示例）：
   `git config --global http.proxy http://127.0.0.1:7897`，
   打包前设置 `$env:HTTPS_PROXY='http://127.0.0.1:7897'`，多执行几次
   `npm run tauri build` 让下载断点续传。
2. 使用本地工具镜像（本仓库实践验证可行）：
   用带重试的 curl 先下载 `nsis-3.13.zip` 与 `nsis_tauri_utils.dll`，
   按 `https/github.com/...` 的目录结构放到静态目录，用
   `..\repo-analysis\mirror-server.py` 起本地服务，再设置
   `$env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR='http://127.0.0.1:8765'` 后打包。

## 版本发布（Release）

### 发布渠道

桌面端代码托管在个人云端仓库 `Jin-Din/cesium-terrain-builder` 的 `desktop`
分支（位于 `desktop/` 目录），正式版本通过 GitHub Release 发布：
<https://github.com/Jin-Din/cesium-terrain-builder/releases>

### v0.1.0 发布资产

| Release 资产文件（英文命名） | 类型 | 说明 |
| --- | --- | --- |
| `CTB-Terrain-Tool-0.1.0-setup.exe` | NSIS 安装包（约 6 MB） | 双击安装，自动创建开始菜单/桌面快捷方式，含完整 ctb-runtime |
| `CTB-Terrain-Tool-0.1.0-portable.zip` | 免安装绿色版（约 8.5 MB） | 解压即用，顶层 `CTB-Terrain-Tool/` 内 exe 与 `ctb-runtime` 同级 |

> Release 资产统一使用纯英文文件名，避免中文文件名在浏览器下载、跨系统传输时
> 出现编码问题；其内容与本机 `E:\terrain\ctb\tools\` 下的中文命名产物完全一致，
> 对应关系为：`CTB地形切片工具-0.1.0-setup.exe` → `CTB-Terrain-Tool-0.1.0-setup.exe`，
> `CTB地形切片工具-0.1.0-绿色版.zip` → `CTB-Terrain-Tool-0.1.0-portable.zip`。

本机对应产物路径（`E:\terrain\ctb\tools\`）：

- `CTB地形切片工具-0.1.0-setup.exe`：安装包。
- `CTB地形切片工具-0.1.0-绿色版.zip`：绿色版压缩包。
- `CTB-Terrain-Tool\`：与绿色版 zip 内容一致的解压目录，可直接双击 exe 运行。

### 安装版与绿色版如何选择

- **安装版**：适合固定办公机，安装后可通过系统「应用和功能」统一卸载升级。
- **绿色版**：不写注册表、不依赖安装路径，解压到 U 盘或任意目录均可运行，
  适合受限环境、多机拷贝与免管理员场景；删除目录即完成卸载。
- 两种形态功能完全一致，均内置 4 个 ctb 工具（`ctb-tile` 0.4.1、`ctb-info`、
  `ctb-export`、`ctb-extents`）及全部 GDAL 依赖。

### 绿色版使用步骤

1. 解压绿色版 zip（Release 资产 `CTB-Terrain-Tool-0.1.0-portable.zip`，
   本机中文名为 `CTB地形切片工具-0.1.0-绿色版.zip`），保持 `ctb-desktop.exe` 与
   `ctb-runtime` 文件夹同级，不要只单独拷贝 exe。
2. 双击 `ctb-desktop.exe` 启动；首页显示「运行时就绪：4 个工具」即环境正常。
3. 在对应工具页填写表单参数，底部可实时查看等价命令行，点击「开始执行」运行。
4. 若解压目录含中文等非 ASCII 字符，首次启动会自动把 `gdaldata` 部署到
   `C:\ProgramData\ctb-desktop\gdaldata`（纯英文路径，仅部署一次，可被复用），
   无需手工干预。

### 发布前验证记录

- 安装版与绿色版均能正常启动窗口，界面渲染完整。
- 内置 `ctb-tile --version` 输出 0.4.1，`ctb-info` 读取样例瓦片正常。
- `GDAL_DATA` 自动注入、同目录 DLL 加载无误。
- 中文解压目录下 gdaldata 自动部署到 ProgramData（89 个数据文件 +
  `.gdaldata-deployed` 标记），切片坐标系数据加载正常。
