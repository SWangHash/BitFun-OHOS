@echo off
setlocal
rem Always run from this script's folder so installer.nsi resolves.
cd /d "%~dp0"
set "MAKENSIS="
where makensis >nul 2>nul && set "MAKENSIS=makensis"
if not defined MAKENSIS if exist "%ProgramFiles(x86)%\NSIS\makensis.exe" set "MAKENSIS=%ProgramFiles(x86)%\NSIS\makensis.exe"
if not defined MAKENSIS if exist "%ProgramFiles%\NSIS\makensis.exe" set "MAKENSIS=%ProgramFiles%\NSIS\makensis.exe"
if not defined MAKENSIS (
  echo [X] NSIS not found. Install it first:  winget install NSIS.NSIS
  exit /b 1
)
echo Using: %MAKENSIS%
"%MAKENSIS%" installer.nsi
if errorlevel 1 exit /b 1
echo.
echo [OK] BitFun-setup.exe created in this folder.
