@echo off
REM ============================================================================
REM  Vela desktop build (Windows) — reproducible Docker build.
REM
REM  Produces the same single-file per-OS binaries CI ships. Needs ONLY Docker
REM  Desktop on PATH — no Node / pnpm / neu / Python required on the host.
REM
REM  Windows artifacts (what you most likely want):
REM    vela-neutralino\dist\vela\vela-win_x64.exe          (self-contained app)
REM    vela-neutralino\dist\vela-desktop-local-win_x64.zip (app + gatekeeper)
REM
REM  The same run also emits the linux_* / mac_* binaries and their ZIPs.
REM  Output dir (vela-neutralino\dist) is gitignored — never commit binaries.
REM
REM  Usage:  double-click, or from any prompt:  scripts\build-desktop.cmd
REM ============================================================================
setlocal

REM Repo root = one level up from this script (scripts\ -> repo root).
pushd "%~dp0.." || exit /b 1
set "REPO_ROOT=%CD%"

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] docker not found on PATH. Install / start Docker Desktop first.
  popd
  exit /b 1
)

REM Clear the previous export so buildkit can't fail renaming over a locked
REM binary (Windows holds a handle on a freshly written .exe — antivirus scan).
if exist "vela-neutralino\dist\vela" rmdir /s /q "vela-neutralino\dist\vela"
del /q "vela-neutralino\dist\vela-desktop-local-*.zip" >nul 2>&1

echo [vela] Building desktop binaries via Docker...
echo [vela] Build context: %REPO_ROOT%
echo.

set DOCKER_BUILDKIT=1
docker build -f vela-neutralino\Dockerfile -o type=local,dest=vela-neutralino\dist "%REPO_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERROR] Docker build failed. See output above.
  popd
  exit /b 1
)

echo.
echo [vela] Build complete. Windows artifacts:
if exist "vela-neutralino\dist\vela\vela-win_x64.exe" echo   -^> vela-neutralino\dist\vela\vela-win_x64.exe
if exist "vela-neutralino\dist\vela-desktop-local-win_x64.zip" echo   -^> vela-neutralino\dist\vela-desktop-local-win_x64.zip

popd
endlocal
