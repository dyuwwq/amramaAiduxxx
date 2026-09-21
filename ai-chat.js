const messages = document.getElementById("messages");
const form = document.getElementById("chatForm");
const input = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearChat");

let history = [];
let locationCache = null;

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    p => { locationCache = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; },
    () => {},
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 }
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

async function askAI(query) {
  if (!locationCache && navigator.geolocation) {
    try {
      locationCache = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 6000 }
      ));
    } catch (_) {}
  }

  const response = await fetch("/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, history, location: locationCache })
  });

  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.answer || "Ошибка AI-сервера");
  return data;
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
    const data = await askAI(query);
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
