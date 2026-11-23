# @Jin 把 ctb 命令行运行时（exe/dll/gdaldata）同步到 Tauri 打包资源目录
# 用法：
#   .\scripts\prepare-runtime.ps1
#   .\scripts\prepare-runtime.ps1 -Source E:\terrain\ctb\tools\ctb-cesium-jin
param(
    [string]$Source = "E:\terrain\ctb\tools\ctb-cesium-jin"
)

$ErrorActionPreference = "Stop"
$Destination = Join-Path $PSScriptRoot "..\src-tauri\resources\ctb-runtime"

if (-not (Test-Path (Join-Path $Source "ctb-tile.exe"))) {
    throw "源目录 $Source 下未找到 ctb-tile.exe，请通过 -Source 指定正确的 ctb 运行时目录"
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$files = @(
    "ctb-tile.exe",
    "ctb-info.exe",
    "ctb-export.exe",
    "ctb-extents.exe",
    "ctb.dll",
    "gdal202.dll",
    "zlib.dll"
)

foreach ($file in $files) {
    Copy-Item (Join-Path $Source $file) -Destination $Destination -Force
}

# @Jin gdaldata 是 GDAL 运行时数据（坐标系定义等），启动时通过 GDAL_DATA 指向它
Copy-Item (Join-Path $Source "gdaldata") -Destination $Destination -Recurse -Force

Write-Host "ctb 运行时已同步到 $Destination" -ForegroundColor Green
Get-ChildItem $Destination | Select-Object Name, Length | Format-Table -AutoSize
