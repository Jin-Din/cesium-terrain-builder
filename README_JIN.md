# 仓库关系与本地工作流说明（Jin 补充文档）

本文件是对上游英文 `README.md` 的中文补充，记录本地仓库与两个 GitHub 远端的关系，
不修改上游原文，保证后续可以无冲突快进同步。

## 一、三个来源的关系

| 来源 | 地址 / 路径 | 角色 |
| --- | --- | --- |
| fork 上游（upstream） | https://github.com/ahuarte47/cesium-terrain-builder | 原始维护者仓库，**只拉不推** |
| 个人仓库（origin） | https://github.com/Jin-Din/cesium-terrain-builder | 自己的仓库化管理副本，可推送 |
| 本地源码 | `E:\terrain\ctb\source\ctb-source` | 实际工作副本 |

远端配置（`git remote -v` 可见）：

```
origin    https://github.com/Jin-Din/cesium-terrain-builder.git （fetch + push）
upstream  https://github.com/ahuarte47/cesium-terrain-builder.git （仅 fetch）
upstream 的 push 地址被设置为 DISABLE，任何向上游的推送都会直接失败
```

## 二、版本差异分析结论（2026-11 核对）

- 本地源码最初内容与 upstream 提交 `84d7d49`（Add support for GDAL versions
  >= 2.2.0 and <3.0.0）逐字节一致，属于 `master-quantized-mesh` 分支历史中的老节点。
- 个人仓库此前停在 `bf5fe56`，相对 upstream 的 `master-quantized-mesh` 落后 12 个提交，
  `master` 分支落后 4 个提交，且个人仓库没有任何独有提交（严格祖先，可纯快进）。
- 2026-11-23 已将个人仓库两个分支快进到 upstream 最新：
  - `master-quantized-mesh`：`bf5fe56` → `7440667`
  - `master`：`8dd633c` → `d9c29b2`
- 本地工作副本已重置到 `origin/master-quantized-mesh`（当前 = `7440667`），
  与个人仓库、upstream 三者同源；`build/` 编译产物由 `.gitignore` 忽略，不受影响。
- upstream 新增能力（相对老本地源码）：GDAL 3.12/3.13 的 `GDALOverviewDataset`
  兼容垫片、Windows MSVC 构建支持、GitHub Actions CI、索引逻辑与异常处理修复等。

## 三、日常同步流程（只拉不推 upstream）

```powershell
cd E:\terrain\ctb\source\ctb-source

# 1. 抓取两个远端最新引用
git fetch upstream
git fetch origin

# 2. 把 upstream 最新合入本地分支（正常情况为 fast-forward）
git checkout master-quantized-mesh
git pull --rebase upstream master-quantized-mesh

# 3. 同步到个人仓库
git push origin master-quantized-mesh
# master 分支同理：
git checkout master
git pull --rebase upstream master
git push origin master
```

注意：

- 禁止 `git push upstream ...`（已通过 `pushUrl = DISABLE` 强制拦截）。
- 本仓库的自有内容仅为新增文档（如本文件），不改动上游文件，rebase 同步时不会产生冲突；
  若后续需要代码定制，先在个人仓库开特性分支提交，不要直接在跟踪分支上改上游文件。
- 网络抖动时可为本机代理配置：`git config --global http.proxy http://127.0.0.1:7897`。

## 四、工作区目录（E:\terrain\ctb）

| 目录 | 用途 |
| --- | --- |
| `build\gdal_build_2.2.0`、`gdal_build_2.3.1` | GDAL 编译依赖（含 include/lib/bin/data） |
| `build\zlib_build_1.2.11` | zlib 编译依赖 |
| `source\ctb-source` | 本仓库源码（CMake + C++11，VS2022 BuildTools 可编译） |
| `source\cmake-3.16.2-win64-x64` | 便携 CMake |
| `source\zlib-1.2.11` | zlib 源码 |
| `source\CesiumTerrainBuilder编译及地形切片生成教程.docx/pdf` | 中文编译与切片教程 |
| `tools\ctb-cesium-jin` | Jin 编译的 ctb 运行时（4 个 exe + DLL + gdaldata），桌面端默认 sidecar 来源 |
| `tools\ctb-cesium-xin-2019`、`ctb-cesium-xin-support-gzip` | 第三方编译版本对照 |
| `ctb-desktop` | Tauri + sidecar 桌面端工程（图形化包装 ctb 命令行） |

## 五、命令行能力摘要

- `ctb-tile`：DEM → Terrain / Mesh（quantized-mesh）瓦片与 `layer.json`，
  支持层级区间、重采样、多线程、Cesium 友好根瓦片（`-C`）、顶点法线（`-N`）等。
- `ctb-info`：查看瓦片头信息与 ASCII 高程。
- `ctb-export`：单个瓦片按 z/x/y 导出 GeoTIFF。
- `ctb-extents`：输出各层级瓦片覆盖范围 GeoJSON。

桌面端（`E:\terrain\ctb\ctb-desktop`）已把上述参数全部界面化，详见该目录 `README.md`。
