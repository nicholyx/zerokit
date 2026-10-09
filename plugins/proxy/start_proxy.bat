@echo off
rem ===================================================================
rem  start_proxy.bat —— 本文件只做两件事：
rem      1. 找到本机的 Python
rem      2. 把参数原样交给 proxy.py
rem
rem  启动/停止/重启/状态/开机自启/改配置等等全部在 proxy.py 里，
rem  要加功能请改 proxy.py，本文件一般不需要动。
rem
rem  直接双击本文件      = 打开交互菜单
rem  带命令运行：
rem      start_proxy.bat status
rem      start_proxy.bat start / stop / restart / run / help
rem      start_proxy.bat config domain add example.com
rem      start_proxy.bat autostart on
rem   完整命令列表：start_proxy.bat help
rem
rem  注意：本文件保存为 GBK/ANSI 编码，请勿另存为 UTF-8，
rem        否则 cmd 解析中文会错位。
rem ===================================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "PY_SCRIPT=%~dp0proxy.py"
if not exist "%PY_SCRIPT%" (
    echo [错误] 找不到 %PY_SCRIPT%
    echo        请把本 bat 和 proxy.py 放在同一个目录下。
    echo.
    pause
    exit /b 1
)

rem ---- 找到 Python：优先 python.exe（有控制台才能显示交互菜单）----
set "PYEXE="
set "PYARGS="
for /f "delims=" %%i in ('where python.exe 2^>nul ^| findstr /i /v "WindowsApps"') do if not defined PYEXE set "PYEXE=%%i"
if not defined PYEXE for /f "delims=" %%i in ('where py.exe 2^>nul') do if not defined PYEXE set "PYEXE=%%i"
if not defined PYEXE for /f "delims=" %%i in ('where pythonw.exe 2^>nul') do if not defined PYEXE set "PYEXE=%%i"
if not defined PYEXE for /d %%v in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if not defined PYEXE if exist "%%~fv\python.exe" set "PYEXE=%%~fv\python.exe"
if not defined PYEXE for /d %%v in ("%ProgramFiles%\Python3*") do if not defined PYEXE if exist "%%~fv\python.exe" set "PYEXE=%%~fv\python.exe"
if not defined PYEXE if exist "C:\Python313\python.exe" set "PYEXE=C:\Python313\python.exe"

if not defined PYEXE (
    echo [错误] 没有找到可用的 Python 解释器。
    echo.
    echo 请先安装 Python 3，任选一种：
    echo     winget install Python.Python.3.13
    echo     或到 https://www.python.org/downloads/ 下载安装
    echo     （安装时务必勾选 "Add python.exe to PATH"）
    echo.
    pause
    exit /b 1
)

rem py.exe 是启动器，要指定版本
for %%f in ("%PYEXE%") do if /i "%%~nxf"=="py.exe" set "PYARGS=-3"

rem ---- 验证解释器真的能跑（WindowsApps 下的 python.exe 只是商店占位程序）----
"%PYEXE%" %PYARGS% -c "import sys" >nul 2>&1
if errorlevel 1 (
    echo [错误] 找到的解释器无法运行：%PYEXE%
    echo        它可能只是微软商店的占位程序，请安装真正的 Python 3：
    echo            winget install Python.Python.3.13
    echo.
    pause
    exit /b 1
)

rem ---- 交给 proxy.py，参数原样透传 ----
"%PYEXE%" %PYARGS% "%PY_SCRIPT%" %*
if errorlevel 1 (
    echo.
    echo [提示] proxy.py 返回了错误，原因见上面的输出。
    pause
)
exit /b 0