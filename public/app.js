// --- DOM ---
const lobbyScreen  = document.getElementById("lobbyScreen");
const chatScreen   = document.getElementById("chatScreen");
const chat         = document.getElementById("chat");
const input        = document.getElementById("input");
const sendBtn      = document.getElementById("sendBtn");
const micBtn       = document.getElementById("micBtn");
const photoBtn     = document.getElementById("photoBtn");
const photoInput   = document.getElementById("photoInput");
const ttsToggle    = document.getElementById("ttsToggle");
const backBtn      = document.getElementById("backBtn");
const doneBtn      = document.getElementById("doneBtn");
const topicBanner  = document.getElementById("topicBanner");

// --- State ---
let messages = [];
let topic = "";
let currentTopicId = null;
let isWaiting = false;
let ttsEnabled = false;
let currentAudio = null;
let isRecording = false;
let transcript = "";

// --- Progress ---
function getProgress() {
  try { return new Set(JSON.parse(localStorage.getItem("mathlore_progress") || "[]")); }
  catch { return new Set(); }
}
function saveProgress(set) {
  localStorage.setItem("mathlore_progress", JSON.stringify([...set]));
}
function markCompleted(id) {
  const p = getProgress(); p.add(id); saveProgress(p);
}
function isCompleted(id) { return getProgress().has(id); }

// --- Screen switching ---
function showLobby() {
  chatScreen.classList.add("hidden");
  lobbyScreen.classList.remove("hidden");
  backBtn.classList.add("hidden");
  doneBtn.classList.add("hidden");
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  renderLobby();
}

function showChat(topicLabel, topicId) {
  topic = topicLabel;
  currentTopicId = topicId;
  messages = [];
  chat.innerHTML = "";
  lobbyScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  doneBtn.classList.remove("hidden");
  topicBanner.textContent = topicLabel;
  setControls(true);
  messages.push({ role: "user", content: "Начни историю прямо сейчас, с первого предложения. Без вступлений." });
  sendToAPI();
}

backBtn.addEventListener("click", showLobby);

doneBtn.addEventListener("click", () => {
  if (currentTopicId) markCompleted(currentTopicId);
  showLobby();
});

// --- Lobby rendering ---
let selectedGrade = null;

function renderLobby() {
  if (!selectedGrade) {
    renderGradeSelect();
  } else {
    renderTopicLobby(selectedGrade);
  }
}

function renderGradeSelect() {
  lobbyScreen.innerHTML = `
    <div class="grade-screen">
      <div class="grade-screen-bg"></div>
      <div class="grade-screen-title">
        <p class="welcome-greeting">Привет! Я Архи 👋</p>
        <p class="welcome-sub">Выбери свой класс</p>
      </div>
      <div class="grade-buttons">
        ${curriculum.map(g => `
          <button class="grade-btn" data-grade="${g.grade}">${g.label}</button>
        `).join("")}
      </div>
    </div>
  `;
  lobbyScreen.querySelectorAll(".grade-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedGrade = parseInt(btn.dataset.grade);
      renderTopicLobby(selectedGrade);
    });
  });
}

function renderTopicLobby(gradeNum) {
  const gradeData = curriculum.find(g => g.grade === gradeNum);
  const progress = getProgress();

  const totalTopics = gradeData.quarters.reduce((s, q) => s + q.topics.length, 0);
  const doneTopics = gradeData.quarters.reduce((s, q) =>
    s + q.topics.filter(t => progress.has(t.id)).length, 0);
  const pct = Math.round(doneTopics / totalTopics * 100);

  lobbyScreen.innerHTML = `
    <div class="lobby">
      <div class="lobby-header">
        <button class="grade-back-btn">← Классы</button>
        <div class="lobby-title">${gradeData.label}</div>
      </div>
      <div class="overall-progress">
        <div class="progress-label">Пройдено: ${doneTopics} из ${totalTopics} тем</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="quarters">
        ${gradeData.quarters.map((q, qi) => {
          const qDone = q.topics.filter(t => progress.has(t.id)).length;
          const qPct = Math.round(qDone / q.topics.length * 100);
          const isOpen = qi === 0 || q.topics.some(t => !progress.has(t.id) && qi === gradeData.quarters.findIndex(x => x.topics.some(t2 => !progress.has(t2.id))));
          return `
            <div class="quarter ${isOpen ? "open" : ""}" data-qid="${q.id}">
              <div class="quarter-header">
                <span class="quarter-label">${q.label}</span>
                <span class="quarter-progress">${qDone}/${q.topics.length}</span>
                <div class="quarter-bar"><div class="quarter-fill" style="width:${qPct}%"></div></div>
                <span class="quarter-arrow">${isOpen ? "▲" : "▼"}</span>
              </div>
              <div class="quarter-topics">
                ${q.topics.map(t => {
                  const done = progress.has(t.id);
                  return `<button class="topic-btn ${done ? "done" : ""}" data-topic-id="${t.id}" data-topic-label="${t.label}">
                    ${done ? "✓ " : ""}${t.label}
                  </button>`;
                }).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  lobbyScreen.querySelector(".grade-back-btn").addEventListener("click", () => {
    selectedGrade = null;
    renderGradeSelect();
  });

  lobbyScreen.querySelectorAll(".quarter-header").forEach(header => {
    header.addEventListener("click", () => {
      header.closest(".quarter").classList.toggle("open");
    });
  });

  lobbyScreen.querySelectorAll(".topic-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      showChat(btn.dataset.topicLabel, btn.dataset.topicId);
    });
  });
}

// --- TTS ---
ttsToggle.addEventListener("click", () => {
  ttsEnabled = !ttsEnabled;
  ttsToggle.textContent = ttsEnabled ? "🔊" : "🔇";
  ttsToggle.classList.toggle("active", ttsEnabled);
  if (!ttsEnabled && currentAudio) { currentAudio.pause(); currentAudio = null; }
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
  } catch { return null; }
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

// --- Voice input ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.lang = "ru-RU";
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    transcript = Array.from(e.results).map(r => r[0].transcript).join(" ");
  };
  recognition.onend = () => {
    const text = transcript.trim(); transcript = "";
    if (isRecording) { try { recognition.start(); } catch {} return; }
    if (text) sendMessage(text);
  };
  recognition.onerror = () => { transcript = ""; stopRecording(); };
} else {
  micBtn.style.display = "none";
}

function startRecording() {
  if (!recognition || isWaiting || input.disabled) return;
  transcript = ""; isRecording = true;
  micBtn.classList.add("recording"); micBtn.textContent = "🔴";
  try { recognition.start(); } catch {}
}
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  micBtn.classList.remove("recording"); micBtn.textContent = "🎤";
  try { recognition.stop(); } catch {}
}

micBtn.addEventListener("mousedown", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("mouseup", () => stopRecording());
micBtn.addEventListener("mouseleave", () => { if (isRecording) stopRecording(); });
micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", () => stopRecording());

// --- Photo ---
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
  const file = photoInput.files[0]; photoInput.value = "";
  if (!file || isWaiting) return;
  const base64 = await fileToBase64(file);
  const mediaType = file.type || "image/jpeg";
  messages.push({ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
    { type: "text", text: "Я написал ответ на бумаге. Прочитай что там написано и продолжай разговор как обычно." }
  ]});
  addMessage("user", "📷 Отправил фото с решением");
  await sendToAPI();
});

// --- Chat ---
function setControls(enabled) {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  micBtn.disabled = !enabled;
  photoBtn.disabled = !enabled;
}

async function sendToAPI() {
  setControls(false); isWaiting = true; showTyping();
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
  setControls(true); isWaiting = false; input.focus();
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
  div.className = "message typing"; div.id = "typing";
  div.textContent = "Архи думает...";
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
}
function hideTyping() { document.getElementById("typing")?.remove(); }

async function sendMessage(userText) {
  if (isWaiting) return;
  messages.push({ role: "user", content: userText });
  addMessage("user", userText);
  input.value = "";
  await sendToAPI();
}

sendBtn.addEventListener("click", () => { const t = input.value.trim(); if (t) sendMessage(t); });
input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const t = input.value.trim(); if (t) sendMessage(t); } });

// --- Init ---
showLobby();
