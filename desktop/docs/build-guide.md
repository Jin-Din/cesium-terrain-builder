# CTB 地形切片桌面端 —— 编译打包教程

本文档介绍如何从源码编译 `ctb-desktop`，并产出三种交付物：NSIS 安装包、
免安装绿色版、纯命令行（CLI）包。

> 工作目录说明：桌面端源码统一在 cesium-terrain-builder 仓库的
> `desktop/` 子目录维护，本机路径为
> `E:\terrain\ctb\source\ctb-source\desktop`（对应云端 `origin/desktop`
> 分支的 `desktop/` 文件夹）；下文命令均在该目录下执行。

## 一、环境准备

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Rust | stable（MSVC 工具链，本机 1.100 验证通过） | 通过 rustup 安装，默认 `x86_64-pc-windows-msvc` |
| Node.js | 22+（含 npm） | 前端 Vite 构建与 Tauri CLI |
| Visual Studio 2022 Build Tools | 勾选「使用 C++ 的桌面开发」 | 提供 MSVC `link.exe` 与 Windows SDK |
| WebView2 运行时 | Windows 11 自带 | Windows 10 缺失时需单独安装 |
| ctb 运行时 | 4 个 exe + 3 个 DLL + gdaldata | 本机来源 `E:\terrain\ctb\tools\ctb-cesium-jin` |

新终端使用 cargo 前若提示找不到命令，先执行：

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

## 二、同步 ctb 运行时

ctb 的 exe、依赖 DLL（`ctb.dll`、`gdal202.dll`、`zlib.dll`）与 `gdaldata`
不入库（体积大且属二进制依赖），由脚本从 tools 目录同步：

```powershell
cd E:\terrain\ctb\source\ctb-source\desktop
.\scripts\prepare-runtime.ps1
# 来源不同时显式指定：
# .\scripts\prepare-runtime.ps1 -Source E:\terrain\ctb\tools\ctb-cesium-jin
```

同步后 `src-tauri\resources\ctb-runtime\` 应包含 4 个 ctb 工具、3 个 DLL 和
`gdaldata` 目录。

## 三、安装依赖与开发调试

```powershell
npm install

# 界面热更新调试（自动拉起 Tauri 窗口）
npm run tauri dev
```

调试模式下运行时目录解析的最后一级回退指向源码工作区的
`tools/ctb-cesium-jin`，因此即使没执行打包脚本也能联调。

## 四、编译 NSIS 安装包

```powershell
# 仅打 NSIS 安装包（本项目 tauri.conf.json 的默认 target 就是 nsis）
npm run tauri build -- --bundles nsis
```

产物位置：

- 裸 exe：`src-tauri\target\release\ctb-desktop.exe`
- 安装包：`src-tauri\target\release\bundle\nsis\CTB地形切片工具_0.1.0_x64-setup.exe`

首次打包 Tauri 会从 GitHub 下载 NSIS 工具，代理网络下可能出现
`io: unexpected end of file` 或 TLS 握手失败，多执行几次让下载断点续传即可；
本机已缓存 NSIS 工具（`%LOCALAPPDATA%\tauri\NSIS`），后续打包无需再下载。

## 五、制作免安装绿色版

绿色版 = 裸 exe + 同级 `ctb-runtime` 目录，程序启动时优先探测
exe 同级的 `ctb-runtime`（见 `src-tauri\src\lib.rs` 的 `resolve_runtime_dir`）。

```powershell
$green = "E:\terrain\ctb\tools\CTB-Terrain-Tool"
New-Item -ItemType Directory -Force -Path "$green\ctb-runtime" | Out-Null

# 1. 放裸 exe（用 release 产物）
Copy-Item "src-tauri\target\release\ctb-desktop.exe" "$green\" -Force

# 2. 放运行时（与 resources 下内容一致）
Copy-Item "src-tauri\resources\ctb-runtime\*" "$green\ctb-runtime\" -Recurse -Force

# 3. 压缩（顶层目录名保持纯英文，规避部分解压工具的编码问题）
Compress-Archive -Path $green `
  -DestinationPath "E:\terrain\ctb\tools\CTB-Terrain-Tool-0.1.0-portable.zip" -Force
```

目录形态：

```
CTB-Terrain-Tool/
├─ ctb-desktop.exe
└─ ctb-runtime/
   ├─ ctb-tile.exe / ctb-info.exe / ctb-export.exe / ctb-extents.exe
   ├─ ctb.dll / gdal202.dll / zlib.dll
   └─ gdaldata/
```

绿色版解压到含中文的目录时，程序首次启动会自动把 `gdaldata` 部署到
`C:\ProgramData\ctb-desktop\gdaldata`（纯英文路径，带
`.gdaldata-deployed` 标记，仅部署一次），规避 GDAL 2.2 无法打开
非 ASCII `GDAL_DATA` 路径的问题。

## 六、制作纯命令行（CLI）包

CLI 包不含 GUI，只保留 ctb 原生四件套，适合服务器、批处理脚本与老用户：

```powershell
$cli = "E:\terrain\ctb\tools\CTB-Terrain-CLI-0.1.0"
New-Item -ItemType Directory -Force -Path $cli | Out-Null

# 1. 复制工具与依赖
Copy-Item "src-tauri\resources\ctb-runtime\*" $cli -Recurse -Force

# 2. 放入环境变量脚本与中文使用说明（仓库 docs 目录维护）
Copy-Item "docs\env-setup.bat" $cli -Force
Copy-Item "docs\cli-usage.md" "$cli\使用说明.md" -Force

# 3. 压缩（Release 资产统一英文命名）
Compress-Archive -Path $cli `
  -DestinationPath "E:\terrain\ctb\tools\CTB-Terrain-CLI-0.1.0.zip" -Force
```

> 注意：CLI 包没有 GUI 版的自动部署逻辑，GDAL 2.2 在命令行下同样无法读取
> 含中文的 `GDAL_DATA` 路径，请解压到纯英文目录（如 `D:\tools\CTB-Terrain-CLI`）。

## 七、发布到 GitHub Release

本项目用 GitHub REST API 发布（未安装 gh CLI 时可通过 git 凭据管理器取令牌）：

```powershell
# 1. 非交互取出已缓存的 GitHub 令牌
$lines = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($lines | Where-Object { $_ -like 'password=*' }) -replace 'password=',''
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json' }

# 2. 创建 Release（target_commitish 指向 desktop 分支）
$payload = @{ tag_name='v0.1.0'; target_commitish='desktop'; name='CTB 地形切片桌面端 v0.1.0'; body='更新说明' } | ConvertTo-Json
Invoke-RestMethod -Uri 'https://api.github.com/repos/Jin-Din/cesium-terrain-builder/releases' `
  -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $payload

# 3. 上传资产（名称必须纯英文，中文名会被上传链路吞掉字符）
$uri = "https://uploads.github.com/repos/Jin-Din/cesium-terrain-builder/releases/<release-id>/assets?name=CTB-Terrain-CLI-0.1.0.zip"
Invoke-RestMethod -Uri $uri -Method Post -Headers $headers `
  -ContentType 'application/octet-stream' -InFile 'CTB-Terrain-CLI-0.1.0.zip'
```

代理下上传可能遇到 TLS 抖动或流中断（408/连接重置），带重试即可；
个别情况下连接报错但服务端实际已落盘，重试会返回 422 `already_exists`，
先 GET 资产列表核实，不要盲目重复传。

## 八、常见排障

- **`link.exe` 找不到**：未装 VS Build Tools 或未勾选 C++ 工作负载。
- **NSIS 下载失败**：设置 `$env:HTTPS_PROXY='http://127.0.0.1:7897'` 后重试，
  或参考 README「网络受限时的打包排障」配置本地镜像。
- **运行时就绪显示 0 个工具**：检查 `ctb-runtime` 位置是否符合解析优先级，
  或在设置页手动指定 `tools/ctb-cesium-jin`。
- **`Unable to open EPSG support file gcs.csv`**：`GDAL_DATA` 路径含中文，
  GUI 版会自动部署 gdaldata；CLI 版请改用纯英文解压目录。
- **TLS/schannel 握手失败**：本机代理网络的已知抖动，git push/fetch 与
  API 调用统一加重试循环即可。
