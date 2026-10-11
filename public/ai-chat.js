const messages = document.getElementById("messages");
const form = document.getElementById("chatForm");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearChat");
const langSel = document.getElementById("langSel");
const ttsBtn = document.getElementById("ttsBtn");
const micBtn = document.getElementById("micBtn");

// Запросы идут на тот же сервер, откуда открыта страница.
const API_BASE = "";

const LANGS = {
  ru: { tag: "ru-RU", ph: "Напиши вопрос…", listen: "Слушаю…", here: "Вы примерно здесь: ", coords: "Ваши координаты: ", nogeo: "Не получилось определить местоположение. Разреши геолокацию в браузере." },
  kk: { tag: "kk-KZ", ph: "Сұрағыңды жаз…", listen: "Тыңдап тұрмын…", here: "Сіз шамамен мына жердесіз: ", coords: "Координаттарыңыз: ", nogeo: "Орналасқан жерді анықтау мүмкін болмады. Браузерде геолокацияға рұқсат беріңіз." },
  en: { tag: "en-US", ph: "Ask a question…", listen: "Listening…", here: "You are approximately here: ", coords: "Your coordinates: ", nogeo: "Could not get your location. Allow geolocation in the browser." }
};
const WHERE_RE = /(^|[^\p{L}])где я(?![\p{L}])|мо[её] местоположение|where am i|қайдамын/iu;

const store = {
  get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }
};

let history = [];
let locationCache = null;
let lang = store.get("aidux_lang");
if (!LANGS[lang]) {
  const nav = (navigator.language || "ru").slice(0, 2).toLowerCase();
  lang = LANGS[nav] ? nav : "ru";
}
let ttsOn = store.get("aidux_tts") !== "0";

// ---------- Озвучка (SpeechSynthesis, работает в браузере, ключ не нужен) ----------
const synth = window.speechSynthesis || null;
let voices = [];
let unlocked = false;

function loadVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) {
  loadVoices();
  if (synth.addEventListener) synth.addEventListener("voiceschanged", loadVoices);
}

function pickVoice(tag) {
  const t = tag.toLowerCase(), base = t.slice(0, 2);
  const norm = v => v.lang.replace("_", "-").toLowerCase();
  return voices.find(v => norm(v) === t)
    || voices.find(v => norm(v).startsWith(base))
    // казахского голоса на многих устройствах нет: читаем русским
    || (base === "kk" ? voices.find(v => norm(v).startsWith("ru")) : null)
    || null;
}

function cleanForSpeech(t) {
  return String(t)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>~|]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Длинный текст режем на предложения: Chrome обрывает слишком долгие фразы
function splitSpeech(t) {
  const parts = t.match(/[^.!?…\n]+[.!?…]*\s*/g) || [t];
  const out = [];
  let cur = "";
  for (const p of parts) {
    if (cur && (cur + p).length > 180) { out.push(cur.trim()); cur = p; }
    else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// iOS/Safari разрешают говорить только после жеста пользователя: «разблокируем» при первом нажатии
function unlockSpeech() {
  if (unlocked || !synth) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  synth.speak(u);
}

function speak(text) {
  if (!synth) return;
  synth.cancel();
  const clean = cleanForSpeech(text);
  if (!clean) return;
  const voice = pickVoice(LANGS[lang].tag);
  for (const part of splitSpeech(clean)) {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = voice ? voice.lang : LANGS[lang].tag;
    if (voice) u.voice = voice;
    u.rate = 1;
    synth.speak(u);
  }
}

function stopSpeech() { if (synth) synth.cancel(); }

function applyUI() {
  langSel.value = lang;
  input.placeholder = LANGS[lang].ph;
  ttsBtn.textContent = ttsOn ? "🔊" : "🔇";
  ttsBtn.title = ttsOn ? "Озвучка включена" : "Озвучка выключена";
}
if (!synth) ttsBtn.hidden = true;
applyUI();

ttsBtn.addEventListener("click", () => {
  ttsOn = !ttsOn;
  store.set("aidux_tts", ttsOn ? "1" : "0");
  if (ttsOn) unlockSpeech(); else stopSpeech();
  applyUI();
});
langSel.addEventListener("change", () => {
  lang = langSel.value;
  store.set("aidux_lang", lang);
  stopSpeech();
  applyUI();
});

// ---------- Голосовой ввод (SpeechRecognition: Chrome, Edge, Safari) ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
if (!SR) micBtn.hidden = true;

micBtn.addEventListener("click", () => {
  if (!SR) return;
  unlockSpeech();
  if (listening && rec) { rec.stop(); return; }
  stopSpeech();
  rec = new SR();
  rec.lang = LANGS[lang].tag;
  rec.interimResults = true;
  rec.continuous = false;
  rec.onstart = () => { listening = true; micBtn.classList.add("on"); input.placeholder = LANGS[lang].listen; };
  rec.onresult = e => {
    let t = "";
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    input.value = t;
  };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      addMessage("Нет доступа к микрофону. Разреши его в настройках браузера (нужен HTTPS или localhost).", "bot", "error");
    }
  };
  rec.onend = () => {
    listening = false;
    micBtn.classList.remove("on");
    input.placeholder = LANGS[lang].ph;
    if (input.value.trim()) sendMessage(input.value);
  };
  try { rec.start(); } catch (_) {}
});

// ---------- Геолокация ----------
function getLocation(timeout) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 55000, timeout }
    );
  });
}
getLocation(8000).then(l => { if (l) locationCache = l; });

// «Будим» сервер (бесплатный Render засыпает) и проверяем, настроен ли ИИ.
fetch(`${API_BASE}/health`, { cache: "no-store" })
  .then(r => r.json())
  .then(h => {
    if (h && h.ai === false) {
      addMessage("ИИ не настроен: вставь ключ Gemini в файл .env (вместо YOUR_API_KEY) и перезапусти сервер. Карта и голос работают и без ключа.", "bot", "error");
    }
  })
  .catch(() => {});

function addMessage(text, role = "bot", extra = "") {
  const el = document.createElement("div");
  el.className = `ai-message ${role} ${extra}`.trim();
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

// Нажатие на ответ ИИ озвучивает его ещё раз
function markSpeakable(el) {
  if (!synth) return;
  el.classList.add("speakable");
  el.title = "Нажми, чтобы озвучить";
  el.addEventListener("click", () => { unlockSpeech(); speak(el.textContent); });
}

function setLoading(on) {
  sendBtn.disabled = on;
  micBtn.disabled = on;
  sendBtn.textContent = on ? "Думаю…" : "Отправить";
  input.disabled = on;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function whereAmI() {
  const L = LANGS[lang];
  const loc = locationCache || await getLocation(6000);
  if (!loc) return L.nogeo;
  locationCache = loc;
  try {
    const r = await fetchWithTimeout(`${API_BASE}/api/reverse?lat=${loc.lat}&lng=${loc.lng}`, {}, 10000);
    const d = await r.json();
    if (d && d.address) return `${L.here}${d.address}.`;
  } catch (_) {}
  return `${L.coords}${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}.`;
}

async function askAI(query, onStatus) {
  if (!locationCache) locationCache = await getLocation(4000);

  const body = JSON.stringify({ query, history, location: locationCache, lang });
  const MAX_TRIES = 3;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let response = null;
    try {
      response = await fetchWithTimeout(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      }, 90000);
    } catch (err) {
      // Долгое ожидание не повторяем: иначе один вопрос посчитается несколько раз в лимитах
      if (err && err.name === "AbortError") {
        throw new Error("Нейросеть слишком долго не отвечает. Попробуй ещё раз чуть позже.");
      }
      // иначе сеть недоступна: скорее всего, сервер ещё просыпается, повторим
    }

    if (response) {
      let data = null;
      try { data = await response.json(); } catch (_) {}
      // JSON с полем answer = ответил наш сервер (успех или осмысленная ошибка), повторять не нужно
      if (data && typeof data.answer === "string") {
        if (!response.ok) throw new Error(data.answer);
        return data;
      }
      // иначе это ответ хостинга (502/503/504 или HTML-заглушка), пробуем ещё раз
    }

    if (attempt < MAX_TRIES) {
      onStatus && onStatus("Сервер просыпается, подожди немного…");
      await sleep(6000);
    }
  }
  throw new Error("Сервер не отвечает. Скорее всего, он ещё просыпается после паузы. Подожди минуту и повтори вопрос.");
}

async function sendMessage(text) {
  const query = text.trim();
  if (!query || sendBtn.disabled) return;

  unlockSpeech();
  stopSpeech();
  addMessage(query, "user");
  history.push({ role: "user", content: query });
  input.value = "";
  input.style.height = "52px";
  setLoading(true);
  const typing = addMessage("Печатаю…", "bot");

  try {
    let answer;
    if (WHERE_RE.test(query)) {
      answer = await whereAmI(); // отвечаем сами, квоту ИИ не тратим
    } else {
      const data = await askAI(query, msg => { typing.textContent = msg; });
      answer = data.answer || "Нет ответа.";
    }
    typing.textContent = answer;
    markSpeakable(typing);
    history.push({ role: "assistant", content: answer });
    history = history.slice(-12);
    if (ttsOn) speak(answer);
  } catch (err) {
    typing.remove();
    addMessage(err.message || "Нейросеть временно недоступна.", "bot", "error");
    console.error(err);
  } finally {
    setLoading(false);
    input.focus();
  }
}

form.addEventListener("submit", e => { e.preventDefault(); sendMessage(input.value); });
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
});
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});
document.querySelectorAll("[data-question]").forEach(btn => btn.addEventListener("click", () => sendMessage(btn.dataset.question)));
clearBtn.addEventListener("click", () => {
  history = [];
  stopSpeech();
  messages.innerHTML = "";
  addMessage("Чат очищен. Спроси про места, карту, маршруты или AIDUX.");
  input.focus();
});
