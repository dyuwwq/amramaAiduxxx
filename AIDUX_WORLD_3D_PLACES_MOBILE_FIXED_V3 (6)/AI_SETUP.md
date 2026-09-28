# AIDUX AI — как запустить

ИИ работает через отдельный Node-сервер (`server.js`). Live Server в VS Code (порт 5500)
его НЕ заменяет: он отдаёт только сами страницы.

## Быстрый способ (Windows)
1. Двойной клик по `start-ai.bat`.
2. В открывшемся `.env` замени `YOUR_API_KEY` на свой Gemini-ключ (https://aistudio.google.com/apikey), сохрани.
3. Запусти `start-ai.bat` ещё раз — откроется http://localhost:3000/ai-chat.html.

## Вручную
```
npm install
copy .env.example .env      (и вставь ключ в .env)
npm start
```
Открой http://localhost:3000/ai-chat.html

## Проверка
http://localhost:3000/health должен вернуть `{"ok":true,...}`.

## Если ответы не приходят
Смотри окно терминала, где запущен сервер — там печатается настоящая причина ошибки.
Если Google Maps-режим недоступен на твоём тарифе, чат отвечает без карт (не выдумывая места).

Ключ хранится только в `.env` на сервере. Не вставляй его в HTML/JS и не загружай `.env` в GitHub.
