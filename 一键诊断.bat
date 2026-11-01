@echo off
chcp 65001 >nul
echo.
echo   DSH 诊断采集器
echo   ----------------------------------------
echo   这个脚本不依赖 DSH 运行，DSH 打不开时也能用。
echo   它只读文件和进程信息，不会修改任何东西。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose.ps1"
echo.
echo   采集结束。桌面上会有一个 dsh-diagnostics 文件夹，
echo   把里面的 report.zip 发给 AI，并说「DSH 打不开」即可。
echo.
pause
