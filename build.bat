@echo off
setlocal

cd /d "%~dp0"

echo ==============================
echo  ComicViewer Release Build
echo ==============================
echo.

echo [1/3] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    exit /b 1
)
echo.

echo [2/3] Building frontend + Tauri release...
call npx tauri build
if errorlevel 1 (
    echo ERROR: tauri build failed
    exit /b 1
)
echo.

echo ==============================
echo  Build complete!
echo ==============================
echo Output: src-tauri\target\release\comic-viewer.exe
echo Installer: src-tauri\target\release\bundle\
echo.

endlocal
