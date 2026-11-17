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
set "smoothDir=%~dp0release\aircraft-smooth\win-unpacked"
if not exist "%smoothDir%\Atlas Watch.exe" goto openSelected
if not exist "%smoothDir%\resources\app.asar" goto openSelected
if not exist "%appDir%\resources\app.asar" goto useSmooth
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:smoothDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto openSelected
:useSmooth
set "appDir=%smoothDir%"
:openSelected
set "smoothFinalDir=%~dp0release\aircraft-final\win-unpacked"
if not exist "%smoothFinalDir%\Atlas Watch.exe" goto launchSelected
if not exist "%smoothFinalDir%\resources\app.asar" goto launchSelected
if not exist "%appDir%\resources\app.asar" goto useSmoothFinal
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:smoothFinalDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchSelected
:useSmoothFinal
set "appDir=%smoothFinalDir%"
:launchSelected
set "interiorDir=%~dp0release\aircraft-interior\win-unpacked"
if not exist "%interiorDir%\Atlas Watch.exe" goto launchInteriorSelected
if not exist "%interiorDir%\resources\app.asar" goto launchInteriorSelected
if not exist "%appDir%\resources\app.asar" goto useInterior
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:interiorDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchInteriorSelected
:useInterior
set "appDir=%interiorDir%"
:launchInteriorSelected
set "attitudeDir=%~dp0release\aircraft-attitude\win-unpacked"
if not exist "%attitudeDir%\Atlas Watch.exe" goto launchAttitudeSelected
if not exist "%attitudeDir%\resources\app.asar" goto launchAttitudeSelected
if not exist "%appDir%\resources\app.asar" goto useAttitude
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:attitudeDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchAttitudeSelected
:useAttitude
set "appDir=%attitudeDir%"
:launchAttitudeSelected
set "parallaxDir=%~dp0release\aircraft-parallax\win-unpacked"
if not exist "%parallaxDir%\Atlas Watch.exe" goto launchParallaxSelected
if not exist "%parallaxDir%\resources\app.asar" goto launchParallaxSelected
if not exist "%appDir%\resources\app.asar" goto useParallax
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:parallaxDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchParallaxSelected
:useParallax
set "appDir=%parallaxDir%"
:launchParallaxSelected
set "levelViewDir=%~dp0release\aircraft-level-view\win-unpacked"
if not exist "%levelViewDir%\Atlas Watch.exe" goto launchLevelViewSelected
if not exist "%levelViewDir%\resources\app.asar" goto launchLevelViewSelected
if not exist "%appDir%\resources\app.asar" goto useLevelView
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:levelViewDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchLevelViewSelected
:useLevelView
set "appDir=%levelViewDir%"
:launchLevelViewSelected
set "fixedInteriorDir=%~dp0release\aircraft-fixed-interior\win-unpacked"
if not exist "%fixedInteriorDir%\Atlas Watch.exe" goto launchFixedInteriorSelected
if not exist "%fixedInteriorDir%\resources\app.asar" goto launchFixedInteriorSelected
if not exist "%appDir%\resources\app.asar" goto useFixedInterior
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:fixedInteriorDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchFixedInteriorSelected
:useFixedInterior
set "appDir=%fixedInteriorDir%"
:launchFixedInteriorSelected
set "cabin3dDir=%~dp0release\aircraft-3d-interior\win-unpacked"
if not exist "%cabin3dDir%\Atlas Watch.exe" goto launchCabin3dSelected
if not exist "%cabin3dDir%\resources\app.asar" goto launchCabin3dSelected
if not exist "%appDir%\resources\app.asar" goto useCabin3d
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:cabin3dDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchCabin3dSelected
:useCabin3d
set "appDir=%cabin3dDir%"
:launchCabin3dSelected
set "suppliedCabinDir=%~dp0release\aircraft-supplied-interior\win-unpacked"
if not exist "%suppliedCabinDir%\Atlas Watch.exe" goto launchSuppliedCabinSelected
if not exist "%suppliedCabinDir%\resources\app.asar" goto launchSuppliedCabinSelected
if not exist "%appDir%\resources\app.asar" goto useSuppliedCabin
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:suppliedCabinDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchSuppliedCabinSelected
:useSuppliedCabin
set "appDir=%suppliedCabinDir%"
:launchSuppliedCabinSelected
set "optimizedCabinDir=%~dp0release\aircraft-optimized-interior\win-unpacked"
if not exist "%optimizedCabinDir%\Atlas Watch.exe" goto launchOptimizedCabinSelected
if not exist "%optimizedCabinDir%\resources\app.asar" goto launchOptimizedCabinSelected
if not exist "%appDir%\resources\app.asar" goto useOptimizedCabin
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:optimizedCabinDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchOptimizedCabinSelected
:useOptimizedCabin
set "appDir=%optimizedCabinDir%"
:launchOptimizedCabinSelected
set "fastCockpitDir=%~dp0release\aircraft-fast-cockpit\win-unpacked"
if not exist "%fastCockpitDir%\Atlas Watch.exe" goto launchFastCockpitSelected
if not exist "%fastCockpitDir%\resources\app.asar" goto launchFastCockpitSelected
if not exist "%appDir%\resources\app.asar" goto useFastCockpit
powershell.exe -NoProfile -NonInteractive -Command "if ([IO.File]::GetLastWriteTimeUtc((Join-Path $env:fastCockpitDir 'resources\app.asar')) -lt [IO.File]::GetLastWriteTimeUtc((Join-Path $env:appDir 'resources\app.asar'))) { exit 1 }"
if errorlevel 1 goto launchFastCockpitSelected
:useFastCockpit
set "appDir=%fastCockpitDir%"
:launchFastCockpitSelected
if not exist "%appDir%\Atlas Watch.exe" (
    echo Could not find Atlas Watch.exe in "%appDir%".
    echo Run npm run dist:dir from the project folder, then try again.
    pause
    exit /b 1
)
ver >nul
start "" /D "%appDir%" "%appDir%\Atlas Watch.exe"
exit /b %errorlevel%
