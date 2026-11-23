@echo off
rem @Jin CTB CLI runtime setup for current cmd session only
set "CTB_HOME=%~dp0"
if "%CTB_HOME:~-1%"=="\" set "CTB_HOME=%CTB_HOME:~0,-1%"

if not exist "%CTB_HOME%\gdaldata" (
  echo [ERROR] gdaldata not found next to this script: %CTB_HOME%
  goto :end
)

set "GDAL_DATA=%CTB_HOME%\gdaldata"
set "PATH=%CTB_HOME%;%PATH%"

echo [OK] GDAL_DATA=%GDAL_DATA%
echo [OK] PATH prepended: %CTB_HOME%
echo.
ctb-tile --version
echo.
echo Tools ready: ctb-tile / ctb-info / ctb-export / ctb-extents
echo Note: settings apply to THIS cmd window only. Re-run after closing it.

:end
echo.
pause