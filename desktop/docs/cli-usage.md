# CTB 命令行工具使用说明（v0.1.0）

本包是 Cesium Terrain Builder 的 Windows 纯命令行版本，包含四个工具：

| 工具 | 用途 |
| --- | --- |
| `ctb-tile.exe` | 核心切片工具，把 DEM/栅格数据切成 Terrain 或 Quantized Mesh 瓦片 |
| `ctb-info.exe` | 查看单个瓦片文件的高度、子瓦片、类型等信息 |
| `ctb-export.exe` | 按层级/行列号导出指定瓦片 |
| `ctb-extents.exe` | 输出数据集各层级覆盖范围的 GeoJSON |

依赖文件 `ctb.dll`、`gdal202.dll`、`zlib.dll` 与坐标系数据目录 `gdaldata/`
必须与四个 exe 保持同级，不要单独挪动 exe。

## 一、环境变量配置

### 方式 1：一键脚本（推荐）

双击或在当前 cmd 窗口执行 `env-setup.bat`，脚本会自动把本目录加入
当前会话的 `PATH`，并把 `GDAL_DATA` 指向同级 `gdaldata`。
注意脚本只对当前命令行窗口生效，关掉窗口后需重新执行。

### 方式 2：手工配置（永久生效）

1. 新建系统/用户环境变量 `GDAL_DATA`，值为本目录下的 `gdaldata` 完整路径，
   例如 `D:\tools\CTB-Terrain-CLI\gdaldata`。
2. 把本目录（exe 所在目录）追加到 `PATH` 环境变量。
3. 重新打开命令行窗口使配置生效。

> 重要：GDAL 2.2（`gdal202.dll`）无法打开含中文等非 ASCII 字符的
> `GDAL_DATA` 路径，本包请解压到纯英文目录使用，例如
> `D:\tools\CTB-Terrain-CLI`，切勿放在「桌面\地形工具」这类中文路径下。

## 二、验证安装

```bat
ctb-tile --version
ctb-tile --help
```

正常应输出版本号 `0.4.1` 与完整参数帮助。

## 三、ctb-tile 常用参数

| 参数 | 含义 |
| --- | --- |
| `-o, --output-dir <dir>` | 瓦片输出目录（默认当前工作目录） |
| `-f, --output-format <format>` | 输出格式：`Terrain`（默认）或 `Mesh`（Quantized Mesh） |
| `-p, --profile <profile>` | 切片剖面：`geodetic`（默认，EPSG:4326）或 `mercator` |
| `-s, --start-zoom <zoom>` | 起始层级（数值大于结束层级，从高往低切） |
| `-e, --end-zoom <zoom>` | 结束层级，最小为 0 |
| `-r, --resampling-method <算法>` | 重采样：nearest/bilinear/cubic/cubicspline/lanczos/average/mode 等，默认 average |
| `-c, --thread-count <count>` | 线程数，默认等于 CPU 核数 |
| `-t, --tile-size <size>` | 瓦片像素尺寸，Terrain 默认 65，其他格式默认 256 |
| `-g, --mesh-qfactor <factor>` | Mesh 几何误差系数，越大网格越简化、质量越低，默认 1.0 |
| `-l, --layer` | 只输出 `layer.json` 元数据 |
| `-C, --cesium-friendly` | 强制补齐缺失的根瓦片，保证 CesiumJS 可直接加载 |
| `-R, --resume` | 断点续跑，不覆盖已有文件 |
| `-N, --vertex-normals` | 写入八进制编码顶点法线（仅 Mesh，用于地形光照） |
| `-q, --quiet` / `-v, --verbose` | 减少/增加日志输出 |
| `-z, -m, -n` | 变换误差阈值、warp 内存上限、GDAL 创建选项（高级参数） |

> 说明：早期内部文档曾提到 `-G` gzip 开关，经在本编译版（0.4.1）实测
> `ctb-tile -G` 返回 `unrecognized flag`，该参数当前不可用，需要压缩时
> 请在切片完成后用外部工具（如 7-Zip/gzip）处理。

## 四、典型工作流

### 1. 生产 Quantized Mesh 瓦片

```bat
ctb-tile -o D:\terrain\export\srtm_dem -f Mesh -s 10 -e 0 -r nearest -c 4 -C D:\terrain\demdata\srtm.tif
```

### 2. 只生成 / 刷新 layer.json

```bat
ctb-tile -o D:\terrain\export\srtm_dem -l -f Mesh -C D:\terrain\demdata\srtm.tif
```

### 3. 默认 Terrain 格式切片

```bat
ctb-tile -o D:\terrain\export\srtm_terrain -f Terrain -C D:\terrain\demdata\srtm.tif
```

### 4. 成果检查

```bat
:: 查看 0 级根瓦片信息
ctb-info D:\terrain\export\srtm_dem\0\0\0.terrain

:: 输出各层级覆盖范围 GeoJSON
ctb-extents -o D:\terrain\export\extents D:\terrain\demdata\srtm.tif

:: 导出指定瓦片
ctb-export -i D:\terrain\export\srtm_dem\5\12\8.terrain -z 5 -x 12 -y 8 -o D:\tile.terrain
```

## 五、根瓦片缺失的处理（生产经验）

1. 先检查成果 `0\0\` 下是否存在 `0.terrain`，没有则执行下面两步。
2. 打开 `layer.json`，确认 `available` 节点第一项为
   `{"startX":0,"startY":0,"endX":1,"endY":0}`，不对则手工修正。
3. 用带 `-C`（cesium-friendly）重新切出的 `0` 文件夹替换成果中的 `0` 文件夹。

## 六、常见问题

- **`Unable to open EPSG support file gcs.csv`**：`GDAL_DATA` 未配置或路径含中文，
  按第一节重新配置并改用纯英文目录。
- **提示找不到 `gdal202.dll` / `ctb.dll`**：exe 与 DLL 被分开移动了，
  恢复包内同级目录结构，或把目录加入 `PATH`。
- **中文路径数据源报错**：输入 tif 路径与输出路径也尽量使用纯英文。
- **多线程内存不足**：用 `-c 2` 降低线程数，或用 `-m` 限制 warp 内存。

---------- Compile by Jin ------------
