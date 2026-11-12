@echo off
setlocal
set "appDir=%~dp0release\win-unpacked"
set "flightDir=%~dp0release\flight-card\win-unpacked"
if not exist "%flightDir%\Atlas Watch.exe" goto launch
if not exist "%flightDir%\resources\app.asar" goto launch
if not exist "%appDir%\Atlas Watch.exe" goto flight
if not exist "%appDir%\resources\app.asar" goto flight
rem A running Windows app can keep its folder locked during a new build.
rem Prefer the newer package when a side-by-side build is available.
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:flightDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launch
:flight
set "appDir=%flightDir%"
:launch
if not exist "%appDir%\Atlas Watch.exe" (
    echo Could not find Atlas Watch.exe in "%appDir%".
    echo Run npm run dist:dir from the project folder, then try again.
    pause
    exit /b 1
)
ver >nul
start "" /D "%appDir%" "%appDir%\Atlas Watch.exe"
exit /b %errorlevel%
