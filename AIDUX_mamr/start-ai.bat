@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .env (
  copy .env.example .env >nul
)

findstr /C:"YOUR_API_KEY" .env >nul
if not errorlevel 1 (
  echo.
  echo Вставь свой Gemini API-ключ в файл .env вместо YOUR_API_KEY,
  echo сохрани файл, закрой блокнот и запусти start-ai.bat снова.
  echo Ключ можно получить бесплатно: https://aistudio.google.com/apikey
  echo.
  notepad .env
  pause
  exit /b
)

if not exist node_modules (
  echo Устанавливаю зависимости, подожди...
  call npm.cmd install
)

start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/ai-chat.html"
echo Сервер AIDUX запускается. Не закрывай это окно, пока пользуешься ИИ.
call npm.cmd start
pause
