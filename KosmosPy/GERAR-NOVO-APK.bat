@echo off
setlocal
set "SCRIPT=%~dp0scripts\build-release-apk.ps1"

if not exist "%SCRIPT%" (
  echo Nao encontrei scripts\build-release-apk.ps1.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "RESULTADO=%ERRORLEVEL%"

if not "%RESULTADO%"=="0" (
  echo.
  echo A criacao do APK falhou. Leia a mensagem acima e confira o guia.
  pause
  exit /b %RESULTADO%
)

echo.
echo APK criado na pasta output.
pause
exit /b 0
