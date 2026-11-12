@echo off
setlocal
set "appDir=%~dp0release\win-unpacked"
set "flightDir=%~dp0release\flight-card\win-unpacked"
if not exist "%flightDir%\Atlas Watch.exe" goto alternate
if not exist "%flightDir%\resources\app.asar" goto alternate
if not exist "%appDir%\Atlas Watch.exe" goto flight
if not exist "%appDir%\resources\app.asar" goto flight
rem A running Windows app can keep its folder locked during a new build.
rem Prefer the newer package when a side-by-side build is available.
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:flightDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto alternate
:flight
set "appDir=%flightDir%"
:alternate
set "alternateDir=%~dp0release\imagery-update\win-unpacked"
if not exist "%alternateDir%\Atlas Watch.exe" goto launch
if not exist "%alternateDir%\resources\app.asar" goto launch
if not exist "%appDir%\Atlas Watch.exe" goto useAlternate
if not exist "%appDir%\resources\app.asar" goto useAlternate
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:alternateDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launch
:useAlternate
set "appDir=%alternateDir%"
:launch
set "latestDir=%~dp0release\photoreal-fix\win-unpacked"
if not exist "%latestDir%\Atlas Watch.exe" goto run
if not exist "%latestDir%\resources\app.asar" goto run
if not exist "%appDir%\resources\app.asar" goto useLatest
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:latestDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto run
:useLatest
set "appDir=%latestDir%"
:run
set "cityDir=%~dp0release\photoreal-v2\win-unpacked"
if not exist "%cityDir%\Atlas Watch.exe" goto startApp
if not exist "%cityDir%\resources\app.asar" goto startApp
if not exist "%appDir%\resources\app.asar" goto useCity
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:cityDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto startApp
:useCity
set "appDir=%cityDir%"
:startApp
set "finalDir=%~dp0release\photoreal-v3\win-unpacked"
if not exist "%finalDir%\Atlas Watch.exe" goto doStart
if not exist "%finalDir%\resources\app.asar" goto doStart
if not exist "%appDir%\resources\app.asar" goto useFinal
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:finalDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto doStart
:useFinal
set "appDir=%finalDir%"
:doStart
set "polarDir=%~dp0release\polar-update\win-unpacked"
if not exist "%polarDir%\Atlas Watch.exe" goto launchApp
if not exist "%polarDir%\resources\app.asar" goto launchApp
if not exist "%appDir%\resources\app.asar" goto usePolar
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:polarDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchApp
:usePolar
set "appDir=%polarDir%"
:launchApp
set "arcticDir=%~dp0release\arctic-update\win-unpacked"
if not exist "%arcticDir%\Atlas Watch.exe" goto openApp
if not exist "%arcticDir%\resources\app.asar" goto openApp
if not exist "%appDir%\resources\app.asar" goto useArctic
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:arcticDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto openApp
:useArctic
set "appDir=%arcticDir%"
:openApp
set "linesDir=%~dp0release\arctic-lines\win-unpacked"
if not exist "%linesDir%\Atlas Watch.exe" goto startNewest
if not exist "%linesDir%\resources\app.asar" goto startNewest
if not exist "%appDir%\resources\app.asar" goto useLines
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:linesDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto startNewest
:useLines
set "appDir=%linesDir%"
:startNewest
set "edgeDir=%~dp0release\arctic-edge\win-unpacked"
if not exist "%edgeDir%\Atlas Watch.exe" goto startSelected
if not exist "%edgeDir%\resources\app.asar" goto startSelected
if not exist "%appDir%\resources\app.asar" goto useEdge
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:edgeDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto startSelected
:useEdge
set "appDir=%edgeDir%"
:startSelected
set "poleDir=%~dp0release\arctic-pole\win-unpacked"
if not exist "%poleDir%\Atlas Watch.exe" goto startFinal
if not exist "%poleDir%\resources\app.asar" goto startFinal
if not exist "%appDir%\resources\app.asar" goto usePole
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:poleDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto startFinal
:usePole
set "appDir=%poleDir%"
:startFinal
set "closeDir=%~dp0release\arctic-close\win-unpacked"
if not exist "%closeDir%\Atlas Watch.exe" goto runSelected
if not exist "%closeDir%\resources\app.asar" goto runSelected
if not exist "%appDir%\resources\app.asar" goto useClose
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:closeDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto runSelected
:useClose
set "appDir=%closeDir%"
:runSelected
if not exist "%appDir%\Atlas Watch.exe" (
    echo Could not find Atlas Watch.exe in "%appDir%".
    echo Run npm run dist:dir from the project folder, then try again.
    pause
    exit /b 1
)
ver >nul
start "" /D "%appDir%" "%appDir%\Atlas Watch.exe"
exit /b %errorlevel%
