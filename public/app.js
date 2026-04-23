const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const photoBtn = document.getElementById("photoBtn");
const photoInput = document.getElementById("photoInput");
const startBtn = document.getElementById("startBtn");
const ttsToggle = document.getElementById("ttsToggle");

let messages = [];
let isWaiting = false;
let ttsEnabled = false;
let currentAudio = null;
let isRecording = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (e) => {
    const text = Array.from(e.results).map(r => r[0].transcript).join(" ");
    if (text.trim()) {
      stopRecording();
      sendMessage(text.trim());
    }
  };

  recognition.onerror = () => stopRecording();
} else {
  micBtn.style.display = "none";
}

function startRecording() {
  if (!recognition || isWaiting || input.disabled) return;
  isRecording = true;
  micBtn.classList.add("recording");
  micBtn.textContent = "🔴";
  recognition.start();
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  micBtn.classList.remove("recording");
  micBtn.textContent = "🎤";
  try { recognition.stop(); } catch {}
}

micBtn.addEventListener("mousedown", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("mouseup", () => stopRecording());
micBtn.addEventListener("mouseleave", () => { if (isRecording) stopRecording(); });
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", () => stopRecording());

ttsToggle.addEventListener("click", () => {
  ttsEnabled = !ttsEnabled;
  ttsToggle.textContent = ttsEnabled ? "🔊" : "🔇";
  ttsToggle.classList.toggle("active", ttsEnabled);
  if (!ttsEnabled && currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
});

async function fetchAudio(text) {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.play();
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
  });
}

function splitIntoChunks(text, maxChars = 150) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += " " + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function speak(text) {
  if (!ttsEnabled) return;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  const chunks = splitIntoChunks(text, 150);
  let nextPromise = fetchAudio(chunks[0]);

  for (let i = 0; i < chunks.length; i++) {
    if (!ttsEnabled) break;
    const prefetch = i + 1 < chunks.length ? fetchAudio(chunks[i + 1]) : null;
    const url = await nextPromise;
    if (!url || !ttsEnabled) break;
    await playAudio(url);
    nextPromise = prefetch;
  }
}

function setControls(enabled) {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  micBtn.disabled = !enabled;
  photoBtn.disabled = !enabled;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

photoBtn.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  photoInput.value = "";
  if (!file || isWaiting) return;

  const base64 = await fileToBase64(file);
  const mediaType = file.type || "image/jpeg";

  const photoMessage = {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Я написал ответ на бумаге. Прочитай что там написано и продолжай разговор как обычно." }
    ]
  };

  messages.push(photoMessage);
  addMessage("user", "📷 Отправил фото с решением");
  await sendToAPI();
});

async function sendToAPI() {
  setControls(false);
  isWaiting = true;
  showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    const data = await res.json();
    hideTyping();

    if (data.reply) {
      messages.push({ role: "assistant", content: data.reply });
      addMessage("bot", data.reply);
      speak(data.reply);
    } else {
      addMessage("bot", "Что-то пошло не так. Попробуй ещё раз.");
    }
  } catch {
    hideTyping();
    addMessage("bot", "Не могу связаться с сервером. Проверь соединение.");
  }

  setControls(true);
  isWaiting = false;
  input.focus();
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role === "user" ? "user" : "bot"}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "message typing";
  div.id = "typing";
  div.textContent = "Архи думает...";
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function hideTyping() {
  document.getElementById("typing")?.remove();
}

async function sendMessage(userText) {
  if (isWaiting) return;
  messages.push({ role: "user", content: userText });
  addMessage("user", userText);
  input.value = "";
  await sendToAPI();
}

// Старт истории
startBtn.addEventListener("click", async () => {
  // Убираем welcome-экран
  chat.innerHTML = "";
  setControls(true);

  // Первое сообщение от бота — запускаем историю
  await sendMessage("Привет! Расскажи мне историю про Архимеда");
});

// Отправка по кнопке
sendBtn.addEventListener("click", () => {
  const text = input.value.trim();
  if (text) sendMessage(text);
});

// Отправка по Enter
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const text = input.value.trim();
    if (text) sendMessage(text);
  }
});
