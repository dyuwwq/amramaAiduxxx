// AIDUX AI backend — Gemini + Google Maps grounding
// 1) Copy .env.example to .env
// 2) Put your Gemini API key in GEMINI_API_KEY
// 3) Run: npm install, then npm start (or start.bat on Windows)

import express from "express";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.set("trust proxy", 1); // за прокси хостинга берём настоящий IP посетителя, иначе лимиты будут общими на всех
const PORT = process.env.PORT || 5500;
// Раздаём только папку public: так .env и server.js не доступны по HTTP
const ROOT = path.join(__dirname, "public");

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)");
  next();
});
app.use(express.static(ROOT, { dotfiles: "deny" }));
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
  "index.html", "about.html", "map.html", "ar-nav.html", "vr.html", "contact.html", "ai-chat.html"
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

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-2.5-flash";

function extractCitations(interaction) {
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
  return citations.slice(0, 8);
}

// Errors where retrying with another model/tool makes no sense
const FATAL_RE = /api key|api_key|permission|unauthori|forbidden|\b40[13]\b|quota|\b429\b|rate limit|resource exhausted|location is not supported/i;

// Maps-инструмент медленный: подключаем его только к вопросам про места, а при исчерпанной квоте отключаем на 10 минут
const PLACE_RE = /рядом|поблизости|ближайш|где |куда |адрес|заведен|кафе|ресторан|поесть|позавтрак|пообедать|поужинать|кофе|аптек|магазин|бильярд|кино|парк|клуб|отел|гостиниц|день рождения|отпраздновать|как добраться|near|restaurant|cafe|pharmacy|hotel/i;
let mapsPausedUntil = 0;

// Без таймаута зависший запрос к Gemini мог висеть минутами. Ограничиваем каждую попытку и общее время.
const ATTEMPT_TIMEOUT_MS = 20000;
const TOTAL_BUDGET_MS = 40000;
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout: Gemini не ответил за " + Math.round(ms / 1000) + " с")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function askGemini(ai, prompt, location, query = "") {
  const startedAt = Date.now();
  const mapsTool = validCoords(location)
    ? { type: "google_maps", latitude: Number(location.lat), longitude: Number(location.lng) }
    : { type: "google_maps" };

  // 1) Maps grounding  2) same model without Maps  3) stable fallback model without Maps
  const placeQuestion = PLACE_RE.test(query);
  const attempts = [
    ...(placeQuestion && Date.now() > mapsPausedUntil ? [{ model: MODEL, maps: true }] : []),
    { model: MODEL, maps: false },
    ...(MODEL !== FALLBACK_MODEL ? [{ model: FALLBACK_MODEL, maps: false }] : [])
  ];

  let lastError = new Error("empty answer");
  for (const a of attempts) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS) break;
    try {
      const t0 = Date.now();
      const input = (a.maps || !placeQuestion)
        ? prompt
        : `${prompt}\n\nВАЖНО: картографический источник сейчас недоступен. Не называй конкретные заведения, адреса, рейтинги и часы работы — честно скажи, что не можешь их проверить, и посоветуй воспользоваться поиском мест на карте AIDUX.`;
      const interaction = await withTimeout(ai.interactions.create({
        model: a.model,
        input,
        ...(a.maps ? { tools: [mapsTool] } : {})
      }), ATTEMPT_TIMEOUT_MS);
      const answer = interaction.output_text?.trim();
      console.log(`Gemini ответил за ${Date.now() - t0} мс (model=${a.model}, maps=${a.maps})`);
      if (answer) return { answer, citations: a.maps ? extractCitations(interaction) : [] };
      lastError = new Error("empty answer");
    } catch (error) {
      lastError = error;
      console.error(`Gemini attempt failed (model=${a.model}, maps=${a.maps}):`, error?.message || error);
      const msg = String(error?.message || "");
      const isQuota = /quota|\b429\b|rate limit|resource exhausted/i.test(msg);
      // Ключ, доступ, регион: повторять бессмысленно. Квоту не считаем фатальной: у Maps-инструмента и у разных моделей лимиты отдельные
      if (a.maps && (isQuota || /^timeout/.test(msg))) mapsPausedUntil = Date.now() + 10 * 60 * 1000;
      if (FATAL_RE.test(msg) && !isQuota) throw error;
    }
  }
  throw lastError;
}

// Защита ключа на публичном сайте: лимит на человека и общий лимит в сутки (AI_DAILY_LIMIT в настройках, по умолчанию 300)
const askHits = new Map();
setInterval(() => askHits.clear(), 5 * 60 * 1000).unref();
let askDay = { day: "", count: 0 };
const ASK_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 300;
app.use("/ask", (req, res, next) => {
  const now = Date.now(), day = new Date().toISOString().slice(0, 10);
  if (askDay.day !== day) askDay = { day, count: 0 };
  const list = (askHits.get(req.ip) || []).filter(t => now - t < 60000);
  if (list.length >= 10) return res.status(429).json({ answer: "Слишком много вопросов подряд. Подожди минуту." });
  if (askDay.count >= ASK_DAILY_LIMIT) return res.status(429).json({ answer: "На сегодня лимит AI-вопросов исчерпан. Попробуй завтра." });
  list.push(now); askHits.set(req.ip, list); askDay.count++;
  next();
});

app.post("/ask", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const history = cleanHistory(req.body?.history);
  const location = req.body?.location;

  if (!query) return res.status(400).json({ answer: "Напиши вопрос 🙂" });

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey || apiKey === "YOUR_API_KEY") {
    return res.status(500).json({ answer: "ИИ пока не настроен: вставь Gemini API-ключ в файл .env вместо YOUR_API_KEY и перезапусти сервер." });
  }

  try {
    const { GoogleGenAI } = await import("@google/genai"); // грузим только для AI: карта работает и без него
    const ai = new GoogleGenAI({ apiKey });
    const locationText = validCoords(location)
      ? `Текущая геопозиция пользователя: ${Number(location.lat).toFixed(6)}, ${Number(location.lng).toFixed(6)}.`
      : "Текущая геопозиция пользователя недоступна.";

    const prompt = `${SITE_CONTEXT}\n\n${locationText}\n\nИСТОРИЯ ДИАЛОГА:\n${history || "нет"}\n\nНОВЫЙ ВОПРОС ПОЛЬЗОВАТЕЛЯ:\n${query}`;
    const result = await askGemini(ai, prompt, location, query);
    res.json(result);
  } catch (error) {
    console.error("Gemini API error:", error?.message || error);
    const msg = String(error?.message || "");
    if (/quota|\b429\b|rate limit|resource exhausted/i.test(msg)) {
      return res.status(429).json({ answer: "Закончилась доступная квота Gemini. Попробуй позже." });
    }
    if (/api key|api_key|unauthori|\b401\b/i.test(msg)) {
      return res.status(502).json({ answer: "Gemini не принял API-ключ. Проверь GEMINI_API_KEY в файле .env и перезапусти сервер." });
    }
    if (/timeout/i.test(msg)) {
      return res.status(504).json({ answer: "Нейросеть не успела ответить. Попробуй ещё раз или задай вопрос короче." });
    }
    if (/location is not supported/i.test(msg)) {
      return res.status(502).json({ answer: "Gemini API недоступен из твоего региона." });
    }
    res.status(502).json({ answer: "Нейросеть временно недоступна. Подробности смотри в окне терминала, где запущен сервер." });
  }
});

// ===== AIDUX Places API: подсказки, поиск по категориям, данные для карточек =====
// Источники: Photon (автодополнение) и Overpass (места OSM: часы, телефон, сайт).
// Запросы идут через сервер: можно кэшировать, ставить User-Agent и не упираться в лимиты браузера.
const UA = `AIDUX/1.0 (${process.env.CONTACT_EMAIL || "set CONTACT_EMAIL in .env"})`;

const hits = new Map();
setInterval(() => hits.clear(), 5 * 60 * 1000).unref();
app.use("/api", (req, res, next) => {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  list.push(now);
  hits.set(req.ip, list);
  if (list.length > 90) return res.status(429).json({ error: "too many requests" });
  next();
});

const memo = new Map();
async function memoize(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  memo.set(key, { val, exp: Date.now() + ttlMs });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return val;
}

const CATS = {
  food: { label: "Где поесть", emoji: "🍴", f: ['["amenity"~"restaurant|cafe|fast_food|food_court"]'] },
  coffee: { label: "Кофе", emoji: "☕", f: ['["amenity"="cafe"]'] },
  pharmacy: { label: "Аптеки", emoji: "💊", f: ['["amenity"="pharmacy"]'] },
  atm: { label: "Банкоматы", emoji: "🏧", f: ['["amenity"~"atm|bank"]'], noName: true },
  attraction: { label: "Достопримечательности", emoji: "📍", f: ['["tourism"~"attraction|museum|viewpoint|gallery"]', '["historic"~"monument|memorial|castle|ruins"]'] },
  billiards: { label: "Бильярд", emoji: "🎱", f: ['["sport"~"billiards|pool|snooker"]', '["name"~"бильярд|billiard",i]'] },
  birthday: { label: "День рождения", emoji: "🎂", f: ['["amenity"~"events_venue|community_centre"]', '["leisure"~"bowling_alley|amusement_arcade|escape_game|trampoline_park"]', '["amenity"~"restaurant|cafe"]["name"~"банкет|banquet",i]'] },
  sport: { label: "Спорт", emoji: "🏀", f: ['["leisure"~"sports_centre|fitness_centre|sports_hall|pitch"]'] },
  entertainment: { label: "Развлечения", emoji: "🎮", f: ['["amenity"~"cinema|theatre|nightclub|arts_centre"]', '["leisure"~"bowling_alley|amusement_arcade|escape_game|miniature_golf|water_park"]', '["tourism"~"theme_park|zoo|aquarium"]'] }
};
const KIND = {
  restaurant: "Ресторан", cafe: "Кафе", fast_food: "Фастфуд", food_court: "Фудкорт", pharmacy: "Аптека", atm: "Банкомат", bank: "Банк",
  cinema: "Кинотеатр", theatre: "Театр", nightclub: "Ночной клуб", museum: "Музей", attraction: "Достопримечательность",
  viewpoint: "Смотровая площадка", gallery: "Галерея", sports_centre: "Спорткомплекс", fitness_centre: "Фитнес-клуб",
  bowling_alley: "Боулинг", events_venue: "Банкетный зал", amusement_arcade: "Игровой зал", escape_game: "Квест", pitch: "Площадка"
};

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(25000)
      });
      if (!r.ok) throw new Error("overpass " + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const dp = (bLat - aLat) * rad, dl = (bLng - aLng) * rad;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function normalizePlace(el, cat) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
  return {
    id: el.type[0] + el.id,
    name: t["name:ru"] || t.name || cat.label,
    lat, lng,
    emoji: cat.emoji,
    kind: KIND[t.amenity] || KIND[t.tourism] || KIND[t.leisure] || cat.label,
    cuisine: t.cuisine ? t.cuisine.replace(/;/g, ", ").replace(/_/g, " ") : "",
    address: [street, t["addr:city"]].filter(Boolean).join(", "),
    phone: t.phone || t["contact:phone"] || "",
    website: t.website || t["contact:website"] || "",
    hours: t.opening_hours || ""
  };
}

app.get("/api/places", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "lat/lng required" });
  }
  const r = Math.min(15000, Math.max(300, Number(req.query.r) || 5000));
  let cat = CATS[req.query.cat];
  let key = String(req.query.cat);
  if (!cat) {
    const q = String(req.query.q || "").replace(/[^\p{L}\p{N} -]/gu, "").trim().slice(0, 40);
    if (!q) return res.status(400).json({ error: "cat or q required" });
    cat = { label: "Место", emoji: "📍", f: [`["name"~"${q}",i]`] };
    key = "q:" + q.toLowerCase();
  }
  try {
    const places = await memoize(`p:${key}:${lat.toFixed(3)}:${lng.toFixed(3)}:${r}`, 10 * 60 * 1000, async () => {
      const nm = cat.noName ? "" : '["name"]';
      const body = cat.f.map(f => `nwr(around:${r},${lat},${lng})${f}${nm};`).join("");
      const data = await overpass(`[out:json][timeout:20];(${body});out center tags 80;`);
      return (data.elements || []).map(el => normalizePlace(el, cat)).filter(Boolean);
    });
    const out = places
      .map(p => ({ ...p, distance: haversine(lat, lng, p.lat, p.lng) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 40);
    res.set("Cache-Control", "public, max-age=60").json(out);
  } catch (e) {
    console.error("places error:", e?.message || e);
    res.status(502).json({ error: "places unavailable" });
  }
});

// ----- Локальный поиск: адреса и названия рядом с центром поиска (по умолчанию Костанай) -----
const KOSTANAY = { lat: 53.2144, lng: 63.6246 };

// <local>
// Человек пишет «Тауелсиздик», а в OSM «Тәуелсіздік»: каждая буква превращается в класс похожих (обоих регистров).
const FUZZ = { а: "аә", ә: "аә", и: "иі", і: "иі", ы: "ыі", у: "уүұ", ү: "уүұ", ұ: "уүұ", к: "кқ", қ: "кқ", н: "нң", ң: "нң", г: "гғ", ғ: "гғ", х: "хһ", һ: "хһ", о: "оө", ө: "оө", е: "еэ", э: "еэ" };
const fuzzyWord = w => [...w.toLowerCase()].filter(ch => /[\p{L}\p{N}]/u.test(ch)).map(ch => {
  const set = [...(FUZZ[ch] || ch)];
  return "[" + [...new Set([...set, ...set.map(c => c.toUpperCase())])].join("") + "]";
}).join("");
const STOP = new Set(["ул", "улица", "пр", "просп", "проспект", "мкр", "микрорайон", "көшесі", "көш", "даңғылы", "дом", "город", "костанай", "қостанай", "kostanay"]);
const SYN = { плаза: ["plaza"], цум: ["tsum"], март: ["mart"], трц: ["mall", "трк", "тц"], трк: ["трц", "mall"], тц: ["трц", "mall"], молл: ["mall"], аптека: ["pharmacy"], кафе: ["cafe"] };
const words = q => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOP.has(w));
// «Тауелсиздик 55 / 1», «ул. Абая д 5», «Байконур 12а»
function parseAddress(q) {
  const m = q.trim().match(/^(.*?)[\s,]*(?:д\.?|дом|№)?\s*(\d{1,4})\s*(?:(?:\/|\\|к\.?|корп(?:ус)?\.?|-)\s*)?(\d{1,3}|\p{L})?\s*$/iu);
  if (!m) return null;
  const street = words(m[1]).slice(0, 3);
  return street.length ? { street, num: m[2], sub: m[3] || "" } : null;
}
// </local>

const coordsOf = el => ({ lat: el.lat ?? el.center?.lat, lng: el.lon ?? el.center?.lon });

async function addressSearch(addr, lat, lng, R) {
  const st = addr.street.map(fuzzyWord).join(".*");
  const gap = /\d/.test(addr.sub) ? "{1,9}" : "{0,9}"; // между номером и цифровым корпусом разделитель обязателен (иначе 55/1 совпадёт с 551)
  const hn = addr.sub ? `^${addr.num}[^0-9]${gap}${fuzzyWord(addr.sub)}$` : `^${addr.num}([^0-9].*)?$`;
  const data = await overpass(`[out:json][timeout:25];(nwr(around:${R},${lat},${lng})["addr:street"~"${st}"]["addr:housenumber"~"${hn}"];way(around:${R},${lat},${lng})["highway"]["name"~"${st}"];);out center tags 150;`);
  const els = (data.elements || []).filter(e => coordsOf(e).lat != null);
  const houses = els.filter(e => e.tags?.["addr:housenumber"]).map(e => {
    const t = e.tags, c = coordsOf(e);
    const title = `${t["addr:street"]} ${t["addr:housenumber"]}`;
    return { lat: c.lat, lon: c.lng, name: title + (t.name ? " · " + t.name : ""), display_name: [title, t.name, t["addr:city"]].filter(Boolean).join(", "),
      _rank: (t["addr:housenumber"] === addr.num + (addr.sub ? "/" + addr.sub : "") ? 0 : 1) * 1e9 + haversine(lat, lng, c.lat, c.lng) };
  });
  if (houses.length) return houses.sort((a, b) => a._rank - b._rank).slice(0, 6);
  // Дом в OSM не нашли: показываем саму улицу (ближайший к центру поиска участок)
  const streets = new Map();
  for (const e of els.filter(e => e.tags?.highway && e.tags?.name)) {
    const c = coordsOf(e), d = haversine(lat, lng, c.lat, c.lng);
    if (!streets.has(e.tags.name) || streets.get(e.tags.name).d > d) streets.set(e.tags.name, { d, lat: c.lat, lon: c.lng, name: e.tags.name, display_name: e.tags.name + " (дом " + addr.num + (addr.sub ? "/" + addr.sub : "") + " не найден в OSM, показана улица)" });
  }
  return [...streets.values()].sort((a, b) => a.d - b.d).slice(0, 3);
}

async function nameSearch(q, lat, lng, R) {
  const toks = words(q).slice(0, 4);
  if (!toks.length) return [];
  const res = toks.map(t => [t, ...(SYN[t] || [])].map(fuzzyWord).join("|"));
  const data = await overpass(`[out:json][timeout:25];(${res.map(re => `nwr(around:${R},${lat},${lng})["name"~"${re}"];`).join("")});out center tags 150;`);
  const tests = res.map(re => new RegExp(re));
  return (data.elements || []).filter(e => coordsOf(e).lat != null).map(e => {
    const t = e.tags || {}, c = coordsOf(e);
    const names = [t.name, t["name:ru"], t["name:kk"], t["name:en"], t.alt_name, t.brand].filter(Boolean).join(" ");
    const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
    return { lat: c.lat, lon: c.lng, name: t["name:ru"] || t.name, display_name: [t["name:ru"] || t.name, street, t["addr:city"]].filter(Boolean).join(", "),
      _score: tests.filter(r => r.test(names)).length, _d: haversine(lat, lng, c.lat, c.lng) };
  }).filter(x => x._score > 0).sort((a, b) => b._score - a._score || a._d - b._d).slice(0, 8);
}

async function localSearch(q, lat, lng) {
  const R = 25000, addr = parseAddress(q);
  if (addr) { const found = await addressSearch(addr, lat, lng, R); if (found.length) return found; }
  return nameSearch(q, lat, lng, R);
}

// Photon. Вне режима wide результаты жёстко ограничены рамкой ~45 км вокруг центра поиска, иначе вылезают Астана и Россия.
async function photon(q, lat, lng, wide, limit) {
  const dLat = 0.4, dLng = 0.4 / Math.max(0.3, Math.cos(lat * Math.PI / 180));
  const area = wide ? `&lat=${lat}&lon=${lng}` : `&bbox=${(lng - dLng).toFixed(4)},${(lat - dLat).toFixed(4)},${(lng + dLng).toFixed(4)},${(lat + dLat).toFixed(4)}`;
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}${area}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("photon " + r.status);
  const j = await r.json();
  return (j.features || []).map(f => {
    const p = f.properties || {};
    const street = [p.street, p.housenumber].filter(Boolean).join(" ");
    const name = p.name || street || p.city || "Место";
    const rest = [street !== name ? street : "", p.city || p.town || p.village || "", p.state || "", p.country || ""].filter(Boolean);
    return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name, display_name: [name, ...rest].join(", ") };
  });
}

function searchParams(req) {
  const q = String(req.query.q || "").trim().slice(0, 100);
  let lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) ({ lat, lng } = KOSTANAY);
  return { q, lat, lng, wide: req.query.scope === "wide" };
}

// Подсказки при вводе: быстро, только Photon в рамке города
app.get("/api/suggest", async (req, res) => {
  const { q, lat, lng, wide } = searchParams(req);
  if (q.length < 2) return res.json([]);
  try {
    const items = await memoize(`s:${q.toLowerCase()}:${lat.toFixed(2)}:${lng.toFixed(2)}:${wide}`, 3600e3, () => photon(q, lat, lng, wide, 7));
    res.set("Cache-Control", "public, max-age=60").json(items);
  } catch (e) {
    console.error("suggest error:", e?.message || e);
    res.status(502).json({ error: "suggest unavailable" });
  }
});

// Полный поиск (Enter): адрес «улица + дом/корпус» и названия по словам через OSM + Photon, всё рядом с центром поиска
app.get("/api/search", async (req, res) => {
  const { q, lat, lng, wide } = searchParams(req);
  if (q.length < 2) return res.json([]);
  try {
    const items = await memoize(`f:${q.toLowerCase()}:${lat.toFixed(2)}:${lng.toFixed(2)}:${wide}`, 30 * 60 * 1000, async () => {
      const [loc, ph] = await Promise.allSettled([wide ? [] : localSearch(q, lat, lng), photon(q, lat, lng, wide, 8)]);
      if (loc.status === "rejected" && ph.status === "rejected") throw ph.reason;
      const seen = new Set(), out = [];
      for (const it of [...(loc.value || []), ...(ph.value || [])]) {
        const k = it.lat.toFixed(3) + it.lon.toFixed(3) + it.name.toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push({ lat: it.lat, lon: it.lon, name: it.name, display_name: it.display_name }); }
      }
      return out.slice(0, 10);
    });
    res.set("Cache-Control", "public, max-age=60").json(items);
  } catch (e) {
    console.error("search error:", e?.message || e);
    res.status(502).json({ error: "search unavailable" });
  }
});

const server = app.listen(PORT, () => {
  console.log(`AIDUX: http://localhost:${PORT}/map.html`);
});
server.on("error", e => {
  if (e.code === "EADDRINUSE") {
    console.error(`Порт ${PORT} занят: закрой Live Server и другие копии сервера (или поменяй PORT в .env).`);
    process.exit(1);
  }
  throw e;
});
