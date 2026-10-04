@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .env copy .env.example .env >nul

set PORT=5500
for /f "tokens=2 delims==" %%a in ('findstr /B /C:"PORT=" .env') do set PORT=%%a

if not exist node_modules (
  echo Устанавливаю зависимости, подожди...
  call npm.cmd install
  if errorlevel 1 goto fail
)

start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%/map.html"
echo AIDUX: http://localhost:%PORT%/map.html
echo Не закрывай это окно, пока пользуешься сайтом.
call npm.cmd start
pause
exit /b

:fail
echo Не удалось установить зависимости. Проверь, что установлен Node.js 18+ и есть интернет.
pause
