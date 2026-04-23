const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const photoBtn = document.getElementById("photoBtn");
const photoInput = document.getElementById("photoInput");
const drawBtn = document.getElementById("drawBtn");
const drawModal = document.getElementById("drawModal");
const drawCanvas = document.getElementById("drawCanvas");
const clearBtn = document.getElementById("clearBtn");
const cancelDrawBtn = document.getElementById("cancelDrawBtn");
const sendDrawBtn = document.getElementById("sendDrawBtn");
const startBtn = document.getElementById("startBtn");
const ttsToggle = document.getElementById("ttsToggle");

let messages = [];
let topic = "";
let isWaiting = false;
let ttsEnabled = false;
let currentAudio = null;
let isRecording = false;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

let transcript = "";

if (recognition) {
  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (e) => {
    transcript = Array.from(e.results).map(r => r[0].transcript).join(" ");
  };

  recognition.onend = () => {
    const text = transcript.trim();
    transcript = "";
    if (isRecording) {
      // Chrome остановил сам — перезапускаем пока кнопка зажата
      try { recognition.start(); } catch {}
      return;
    }
    if (text) sendMessage(text);
  };

  recognition.onerror = () => {
    transcript = "";
    stopRecording();
  };
} else {
  micBtn.style.display = "none";
}

function startRecording() {
  if (!recognition || isWaiting || input.disabled) return;
  transcript = "";
  isRecording = true;
  micBtn.classList.add("recording");
  micBtn.textContent = "🔴";
  try { recognition.start(); } catch {}
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
  drawBtn.disabled = !enabled;
}

// --- Canvas drawing ---
const ctx = drawCanvas.getContext("2d");
let drawing = false;

function resizeCanvas() {
  const w = drawCanvas.offsetWidth;
  const h = drawCanvas.offsetHeight;
  const imageData = ctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  drawCanvas.width = w;
  drawCanvas.height = h;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  ctx.putImageData(imageData, 0, 0);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function getPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

drawCanvas.addEventListener("mousedown", (e) => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
drawCanvas.addEventListener("mousemove", (e) => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
drawCanvas.addEventListener("mouseup", () => drawing = false);
drawCanvas.addEventListener("mouseleave", () => drawing = false);
drawCanvas.addEventListener("touchstart", (e) => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
drawCanvas.addEventListener("touchmove", (e) => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
drawCanvas.addEventListener("touchend", () => drawing = false);

drawBtn.addEventListener("click", () => {
  drawModal.classList.remove("hidden");
  resizeCanvas();
});

clearBtn.addEventListener("click", () => {
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
});

cancelDrawBtn.addEventListener("click", () => drawModal.classList.add("hidden"));

sendDrawBtn.addEventListener("click", () => {
  const base64 = drawCanvas.toDataURL("image/png").split(",")[1];
  drawModal.classList.add("hidden");

  const drawMessage = {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
      { type: "text", text: "Я нарисовал свой ответ. Посмотри на рисунок и продолжай разговор как обычно." }
    ]
  };

  messages.push(drawMessage);
  addMessage("user", "✏️ Отправил рисунок с ответом");
  sendToAPI();
});

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
      body: JSON.stringify({ messages, topic }),
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
  const topicInput = document.getElementById("topicInput");
  topic = topicInput?.value.trim() || "математика";
  chat.innerHTML = "";
  setControls(true);
  await sendMessage("Привет! Давай начнём.");
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
