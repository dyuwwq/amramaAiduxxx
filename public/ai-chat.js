const messages = document.getElementById("messages");
const form = document.getElementById("chatForm");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearChat");

// Запросы идут на тот же сервер, откуда открыта страница.
const API_BASE = "";

let history = [];
let locationCache = null;

// «Будим» сервер сразу при открытии страницы (бесплатный Render засыпает),
// чтобы к моменту первого вопроса он уже был готов.
fetch(`${API_BASE}/health`, { cache: "no-store" }).catch(() => {});

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    p => { locationCache = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; },
    () => {},
    { enableHighAccuracy: true, maximumAge: 55000, timeout: 8000 }
  );
}

function addMessage(text, role = "bot", extra = "") {
  const el = document.createElement("div");
  el.className = `ai-message ${role} ${extra}`.trim();
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  return el;
}

function setLoading(on) {
  sendBtn.disabled = on;
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

async function askAI(query, onStatus) {
  if (!locationCache && navigator.geolocation) {
    try {
      locationCache = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 55000, timeout: 4000 }
      ));
    } catch (_) {}
  }

  const body = JSON.stringify({ query, history, location: locationCache });
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

  addMessage(query, "user");
  history.push({ role: "user", content: query });
  input.value = "";
  input.style.height = "52px";
  setLoading(true);
  const typing = addMessage("Печатаю…", "bot");

  try {
    const data = await askAI(query, msg => { typing.textContent = msg; });
    typing.textContent = data.answer || "Нет ответа.";
    history.push({ role: "assistant", content: data.answer || "" });
    history = history.slice(-12);
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
  messages.innerHTML = "";
  addMessage("Чат очищен. Спроси про места, карту, маршруты или AIDUX.");
  input.focus();
});
