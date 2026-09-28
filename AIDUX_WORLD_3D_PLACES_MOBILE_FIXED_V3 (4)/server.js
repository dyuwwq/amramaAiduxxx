// AIDUX AI backend — Gemini + Google Maps grounding
// 1) Copy .env.example to .env
// 2) Put your Gemini API key in GEMINI_API_KEY
// 3) Run: npm.cmd install
// 4) Run: npm.cmd start

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

app.use(cors());
app.use(express.json({ limit: "128kb" }));
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)");
  next();
});
app.use(express.static(ROOT));
app.get("/", (_req, res) => res.sendFile("index.html", { root: ROOT }));

const BASE_CONTEXT = `
Ты — узкоспециализированный ассистент AIDUX — интерактивной карты и навигационного сайта.

ТВОЯ ГЛАВНАЯ ЗАДАЧА:
Помогать пользователю ориентироваться по карте, находить места, планировать посещение мест и объяснять функции самого сайта AIDUX.

РАЗРЕШЁННЫЕ ТЕМЫ:
1. Места и организации: кафе, рестораны, завтраки, дни рождения, магазины, аптеки, школы, спорт, развлечения, достопримечательности и другие реальные места.
2. Поиск мест рядом с пользователем или в указанном городе/районе.
3. Часы работы, адреса, рейтинги и другие сведения о местах — только если их удалось получить из подключённого картографического источника. Не выдумывай.
4. Навигация, маршруты и поиск адресов.
5. Функции AIDUX: карта, поиск, маршруты, AR-навигация, GPS, 3D/VR, AI-чат и страницы сайта.
6. Информация, которая действительно присутствует в контексте страниц AIDUX.

СТРОГИЙ ФИЛЬТР:
Если вопрос не связан с картами, местами, навигацией или AIDUX, отвечай ровно по смыслу:
«Я специализированный помощник AIDUX. Я отвечаю только на вопросы о карте, местах, маршрутах и функциях сайта.»
Не поддерживай бессмысленный small talk вроде «как дела?», шутки, игры, общие знания и сторонние темы.

ПРАВИЛА ПО МЕСТАМ:
- Для вопросов вроде «где позавтракать в 9 утра», «где отпраздновать день рождения», «кафе рядом со мной» и т.п. используй Google Maps grounding.
- Учитывай текущую геопозицию пользователя, если она передана.
- Если пользователь назвал город/район, используй его как основной регион поиска.
- Для времени работы учитывай именно указанное время и день недели, если картографические данные позволяют это определить.
- Не говори «открыто», если источник не даёт достаточных данных.
- Если данных недостаточно, честно скажи об этом.
- Не придумывай цены, рейтинги, часы работы, адреса или наличие мест.
- Если найдено несколько подходящих мест, дай короткий список с причиной, почему каждое подходит.

ПРАВИЛА ПО AIDUX:
- Не выдумывай функции, которых нет в контексте сайта.
- Если вопрос о маршруте, объясни, что пользователь может выбрать место на карте/в поиске и построить маршрут.
- Если вопрос об AR, объясняй с учётом GPS, камеры и датчиков ориентации.
- Отвечай на языке пользователя; по умолчанию русский.
- Ответы делай короткими и практичными, обычно 2–6 пунктов.
`;

const PAGE_FILES = [
  "index.html", "about.html", "map.html", "camera.html", "ar.html",
  "ar-nav.html", "vr.html", "contact.html", "ai-chat.html"
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function loadSiteContext() {
  const parts = [];
  for (const file of PAGE_FILES) {
    try {
      const text = stripHtml(fs.readFileSync(path.join(ROOT, file), "utf8"));
      if (text) parts.push(`\n--- ${file} ---\n${text.slice(0, 7000)}`);
    } catch (_) {}
  }
  return parts.join("\n").slice(0, 45000);
}

const SITE_CONTEXT = `${BASE_CONTEXT}\n\nФАКТИЧЕСКИЙ КОНТЕКСТ СТРАНИЦ AIDUX:\n${loadSiteContext()}`;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10)
    .map(m => `${m.role === "user" ? "Пользователь" : "AIDUX AI"}: ${m.content.slice(0, 2500)}`)
    .join("\n");
}

function validCoords(location) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "AIDUX AI", provider: "Gemini" });
});

app.post("/ask", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const history = cleanHistory(req.body?.history);
  const location = req.body?.location;

  if (!query) return res.status(400).json({ answer: "Напиши вопрос 🙂" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "YOUR_API_KEY") {
    return res.status(500).json({ answer: "ИИ пока не настроен: вставь Gemini API-ключ в .env вместо YOUR_API_KEY." });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const locationText = validCoords(location)
      ? `Текущая геопозиция пользователя: ${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}.`
      : "Текущая геопозиция пользователя недоступна.";

    const prompt = `${SITE_CONTEXT}\n\n${locationText}\n\nИСТОРИЯ ДИАЛОГА:\n${history || "нет"}\n\nНОВЫЙ ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n${query}`;

    const tools = validCoords(location)
      ? [{ type: "google_maps", latitude: Number(location.lat), longitude: Number(location.lng) }]
      : [{ type: "google_maps" }];

    const interaction = await ai.interactions.create({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      input: prompt,
      tools
    });

    const answer = interaction.output_text?.trim();
    if (!answer) {
      return res.status(502).json({ answer: "Не удалось получить ответ от картографического ассистента." });
    }

    const citations = [];
    for (const step of interaction.steps || []) {
      if (step.type !== "model_output") continue;
      for (const block of step.content || []) {
        for (const annotation of block.annotations || []) {
          if (annotation.type === "place_citation") {
            citations.push({ name: annotation.name, url: annotation.url });
          }
        }
      }
    }

    res.json({ answer, citations: citations.slice(0, 8) });
  } catch (error) {
    console.error("Gemini API error:", error?.message || error);
    const msg = String(error?.message || "");
    if (/quota|rate|429|resource exhausted/i.test(msg)) {
      return res.status(429).json({ answer: "У бесплатного Gemini сейчас закончилась доступная квота. Попробуй позже." });
    }
    res.status(502).json({ answer: "Нейросеть временно недоступна. Проверь Gemini API-ключ и настройки проекта." });
  }
});

app.listen(PORT, () => {
  console.log(`AIDUX AI server: http://localhost:${PORT}`);
});
