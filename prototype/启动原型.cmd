@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo 原型构建文件不存在，请先联系开发人员重新构建。
  pause
  exit /b 1
)

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:4173"
"C:\Users\胖大妮\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4173 --bind 127.0.0.1 --directory dist

echo.
echo 原型服务已停止。
pause
