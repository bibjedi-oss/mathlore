// ── DOM ──────────────────────────────────────────────────────────────────────
const appDiv        = document.querySelector(".app");
const authScreen    = document.getElementById("authScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const mainHeader    = document.getElementById("mainHeader");
const welcomeScreen = document.getElementById("welcomeScreen");
const welcomeChat   = document.getElementById("welcomeChat");
const welcomeActions= document.getElementById("welcomeActions");
const lobbyScreen   = document.getElementById("lobbyScreen");
const chatScreen    = document.getElementById("chatScreen");
const chat          = document.getElementById("chat");
const input         = document.getElementById("input");
const sendBtn       = document.getElementById("sendBtn");
const micBtn        = document.getElementById("micBtn");
const photoBtn      = document.getElementById("photoBtn");
const photoInput    = document.getElementById("photoInput");
const ttsToggle     = document.getElementById("ttsToggle");
const backBtn       = document.getElementById("backBtn");
const doneBtn       = document.getElementById("doneBtn");
const topicBanner   = document.getElementById("topicBanner");
const phaseBar      = document.getElementById("phaseBar");
const phaseLabel    = document.getElementById("phaseLabel");
const logoutBtn     = document.getElementById("logoutBtn");

// ── State ─────────────────────────────────────────────────────────────────────
let messages = [];
let topic = "";
let currentTopicId = null;
let currentPhase = "theory"; // theory | exercises | test | done
let isWaiting = false;
let ttsEnabled = true;
let currentAudio = null;
let isRecording = false;
let transcript = "";
let currentUser = null; // { role, id, name, grade, ... }
let authToken = null;

// ── Auth helpers ──────────────────────────────────────────────────────────────
function saveToken(token) {
  authToken = token;
  localStorage.setItem("mathlore_token", token);
}
function clearToken() {
  authToken = null;
  localStorage.removeItem("mathlore_token");
}
function parseToken(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch { return null; }
}
function apiHeaders() {
  return { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) };
}

// ── Progress (DB for children, localStorage fallback) ─────────────────────────
async function getProgress() {
  if (currentUser?.role === "child") {
    try {
      const res = await fetch("/api/progress", { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        return new Set(data.completed || []);
      }
    } catch {}
  }
  try { return new Set(JSON.parse(localStorage.getItem("mathlore_progress") || "[]")); }
  catch { return new Set(); }
}
async function markCompleted(id) {
  if (currentUser?.role === "child") {
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ topicId: id, topicLabel: topic, messages, phase: "done" })
      });
    } catch {}
  }
  const p = JSON.parse(localStorage.getItem("mathlore_progress") || "[]");
  if (!p.includes(id)) { p.push(id); localStorage.setItem("mathlore_progress", JSON.stringify(p)); }
}
async function saveSession(phase) {
  if (!currentUser || currentUser.role !== "child" || !currentTopicId) return;
  try {
    await fetch("/api/sessions", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ topicId: currentTopicId, topicLabel: topic, messages, phase })
    });
  } catch {}
}

// ── Screen routing ─────────────────────────────────────────────────────────────
function hideAll() {
  authScreen.classList.add("hidden");
  dashboardScreen.classList.add("hidden");
  mainHeader.classList.add("hidden");
  welcomeScreen.classList.add("hidden");
  welcomeActions.classList.add("hidden");
  lobbyScreen.classList.add("hidden");
  chatScreen.classList.add("hidden");
  appDiv.classList.remove("fullscreen-map");
}

function showAuth() {
  hideAll();
  authScreen.classList.remove("hidden");
}

function showDashboard() {
  hideAll();
  dashboardScreen.classList.remove("hidden");
  renderDashboard();
}

function showWelcome() {
  hideAll();
  mainHeader.classList.remove("hidden");
  backBtn.classList.add("hidden");
  doneBtn.classList.add("hidden");
  welcomeScreen.classList.remove("hidden");
  welcomeActions.classList.remove("hidden");
}

function showLobby() {
  hideAll();
  mainHeader.classList.remove("hidden");
  backBtn.classList.add("hidden");
  doneBtn.classList.add("hidden");
  welcomeActions.classList.add("hidden");
  lobbyScreen.classList.remove("hidden");
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  renderLobby();
}

function showChat(topicLabelArg, topicIdArg) {
  hideAll();
  appDiv.classList.remove("fullscreen-map");
  mainHeader.classList.remove("hidden");
  topic = topicLabelArg;
  currentTopicId = topicIdArg;
  currentPhase = "theory";
  messages = [];
  chat.innerHTML = "";
  chatScreen.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  doneBtn.classList.remove("hidden");
  topicBanner.textContent = topicLabelArg;
  updatePhaseUI();
  setControls(true);
  messages.push({ role: "user", content: "Начни историю прямо сейчас, с первого предложения. Без вступлений." });
  sendToAPI();
}

function updatePhaseUI() {
  const labels = { theory: "Теория", exercises: "Задания из учебника", test: "Финальный тест", done: "Завершено" };
  const btnLabels = { theory: "→ Задания", exercises: "→ Финальный тест" };
  phaseLabel.textContent = labels[currentPhase] || "";
  phaseBar.classList.remove("hidden");
  phaseBar.className = `phase-bar phase-${currentPhase}`;
  if (currentPhase === "test" || currentPhase === "done") {
    doneBtn.classList.add("hidden");
  } else {
    doneBtn.classList.remove("hidden");
    doneBtn.textContent = btnLabels[currentPhase] || "→";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  const stored = localStorage.getItem("mathlore_token");
  if (stored) {
    const payload = parseToken(stored);
    if (payload && payload.exp * 1000 > Date.now()) {
      authToken = stored;
      currentUser = payload;
      if (payload.role === "parent") { showDashboard(); return; }
      if (payload.role === "child") { showWelcome(); return; }
    } else {
      clearToken();
    }
  }
  showAuth();
})();

// ── Auth screen ───────────────────────────────────────────────────────────────
let authTab = "parent";
let parentMode = "login";

document.querySelectorAll(".auth-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    authTab = btn.dataset.tab;
    document.getElementById("parentAuthPanel").classList.toggle("hidden", authTab !== "parent");
    document.getElementById("childAuthPanel").classList.toggle("hidden", authTab !== "child");
  });
});

document.querySelectorAll(".auth-mode").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-mode").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    parentMode = btn.dataset.mode;
    document.getElementById("parentName").classList.toggle("hidden", parentMode !== "register");
    document.getElementById("parentAuthBtn").textContent = parentMode === "login" ? "Войти" : "Зарегистрироваться";
  });
});

document.getElementById("parentAuthBtn").addEventListener("click", async () => {
  const email = document.getElementById("parentEmail").value.trim();
  const password = document.getElementById("parentPassword").value;
  const name = document.getElementById("parentName").value.trim();
  const errEl = document.getElementById("parentAuthError");
  errEl.classList.add("hidden");
  if (!email || !password) { errEl.textContent = "Введите email и пароль"; errEl.classList.remove("hidden"); return; }

  const url = parentMode === "login" ? "/api/auth/parent-login" : "/api/auth/parent-register";
  const body = parentMode === "login" ? { email, password } : { email, password, name };

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "Ошибка"; errEl.classList.remove("hidden"); return; }
    saveToken(data.token);
    currentUser = parseToken(data.token);
    showDashboard();
  } catch {
    errEl.textContent = "Нет связи с сервером"; errEl.classList.remove("hidden");
  }
});

document.getElementById("childAuthBtn").addEventListener("click", async () => {
  const parentEmail = document.getElementById("childParentEmail").value.trim();
  const childName = document.getElementById("childName").value.trim();
  const password = document.getElementById("childPassword").value;
  const errEl = document.getElementById("childAuthError");
  errEl.classList.add("hidden");
  if (!parentEmail || !childName || !password) { errEl.textContent = "Заполни все поля"; errEl.classList.remove("hidden"); return; }

  try {
    const res = await fetch("/api/auth/child-login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentEmail, childName, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "Ошибка"; errEl.classList.remove("hidden"); return; }
    saveToken(data.token);
    currentUser = parseToken(data.token);
    showWelcome();
  } catch {
    errEl.textContent = "Нет связи с сервером"; errEl.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => { clearToken(); currentUser = null; showAuth(); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
document.getElementById("dashLogoutBtn").addEventListener("click", () => { clearToken(); currentUser = null; showAuth(); });

async function renderDashboard() {
  const container = document.getElementById("dashChildren");
  container.innerHTML = `<div class="dash-loading">Загружаю...</div>`;

  try {
    const res = await fetch("/api/parent/children", { headers: apiHeaders() });
    const children = await res.json();

    if (!children.length) {
      container.innerHTML = `
        <div class="dash-empty">У вас пока нет детей. Добавьте первого!</div>
        <div class="dash-add-wrap">${addChildForm()}</div>`;
      setupAddChildForm();
      return;
    }

    container.innerHTML = `
      <div class="dash-add-wrap">${addChildForm()}</div>
      <div class="dash-child-list">
        ${children.map(c => `
          <div class="dash-child-card" data-id="${c.id}">
            <div class="dash-child-name">${c.name}</div>
            <div class="dash-child-grade">${c.grade ? c.grade + " класс" : ""}</div>
            <button class="dash-progress-btn" data-id="${c.id}">Прогресс →</button>
          </div>`).join("")}
      </div>
      <div id="dashChildDetail" class="dash-detail hidden"></div>`;

    setupAddChildForm();

    container.querySelectorAll(".dash-progress-btn").forEach(btn => {
      btn.addEventListener("click", () => loadChildProgress(btn.dataset.id, children.find(c => c.id === btn.dataset.id)?.name));
    });
  } catch {
    container.innerHTML = `<div class="dash-error">Ошибка загрузки</div>`;
  }
}

function addChildForm() {
  return `
    <div class="dash-add-child">
      <div class="dash-add-title">Добавить ребёнка</div>
      <input id="newChildName" class="auth-input" type="text" placeholder="Имя ребёнка" />
      <input id="newChildPassword" class="auth-input" type="text" placeholder="Пароль для входа" />
      <input id="newChildGrade" class="auth-input" type="number" placeholder="Класс (необязательно)" min="1" max="11" />
      <div id="addChildError" class="auth-error hidden"></div>
      <button id="addChildBtn" class="auth-btn">Добавить</button>
    </div>`;
}

function setupAddChildForm() {
  document.getElementById("addChildBtn").addEventListener("click", async () => {
    const btn = document.getElementById("addChildBtn");
    const name = document.getElementById("newChildName").value.trim();
    const password = document.getElementById("newChildPassword").value.trim();
    const grade = parseInt(document.getElementById("newChildGrade").value) || null;
    const errEl = document.getElementById("addChildError");
    errEl.classList.add("hidden");
    if (!name || !password) { errEl.textContent = "Введите имя и пароль"; errEl.classList.remove("hidden"); return; }
    btn.disabled = true; btn.textContent = "Добавляю...";
    try {
      const res = await fetch("/api/parent/children", {
        method: "POST", headers: apiHeaders(),
        body: JSON.stringify({ name, password, grade })
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || "Ошибка"; errEl.classList.remove("hidden"); btn.disabled = false; btn.textContent = "Добавить"; return; }
      renderDashboard();
    } catch {
      errEl.textContent = "Ошибка"; errEl.classList.remove("hidden"); btn.disabled = false; btn.textContent = "Добавить";
    }
  });
}

async function loadChildProgress(childId, childName) {
  const detail = document.getElementById("dashChildDetail");
  detail.classList.remove("hidden");
  detail.innerHTML = `<div class="dash-loading">Загружаю прогресс ${childName}...</div>`;

  try {
    const res = await fetch(`/api/parent/child/${childId}/sessions`, { headers: apiHeaders() });
    const sessions = await res.json();

    if (!sessions.length) {
      detail.innerHTML = `<div class="dash-detail-title">${childName}</div><div class="dash-empty">Пока не начато</div>`;
      return;
    }

    const phaseLabel = { theory: "Теория", exercises: "Задания", test: "Тест", done: "✓ Завершено" };

    detail.innerHTML = `
      <div class="dash-detail-title">${childName}</div>
      <div class="dash-sessions">
        ${sessions.map(s => `
          <div class="dash-session ${s.phase === "done" ? "done" : ""}">
            <div class="dash-session-topic">${s.topic_label || s.topic_id}</div>
            <div class="dash-session-phase">${phaseLabel[s.phase] || s.phase}</div>
            ${s.phase === "done" ? `<button class="dash-summary-btn" data-session="${s.id}">AI-анализ</button>` : ""}
            <div class="dash-summary-text hidden" id="summary-${s.id}"></div>
          </div>`).join("")}
      </div>`;

    detail.querySelectorAll(".dash-summary-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sessionId = btn.dataset.session;
        const summaryEl = document.getElementById(`summary-${sessionId}`);
        btn.disabled = true;
        btn.textContent = "Анализирую...";
        try {
          const res = await fetch(`/api/parent/session/${sessionId}/summary`, { method: "POST", headers: apiHeaders() });
          const data = await res.json();
          summaryEl.textContent = data.summary || "Нет данных";
          summaryEl.classList.remove("hidden");
          btn.style.display = "none";
        } catch {
          btn.textContent = "Ошибка";
          btn.disabled = false;
        }
      });
    });
  } catch {
    detail.innerHTML = `<div class="dash-error">Ошибка загрузки</div>`;
  }
}

// ── Welcome screen ─────────────────────────────────────────────────────────────
const ARCHI_INTRO = "Я Архи — твой гид по математике! Здесь мы не учим по учебнику. Ты выбираешь тему, а я рассказываю историю о том, как её открыли — в Древней Греции, Средневековье или на заводе двести лет назад. Потом разбираемся вместе, и математика становится понятной сама собой.";

function addWelcomeMessage(role, text) {
  const div = document.createElement("div");
  div.className = `message ${role === "user" ? "user" : "bot"}`;
  div.textContent = text;
  welcomeChat.appendChild(div);
  welcomeChat.scrollTop = welcomeChat.scrollHeight;
}

document.getElementById("hiBtn").addEventListener("click", async () => {
  welcomeActions.innerHTML = "";
  addWelcomeMessage("user", "Привет 👋");
  const typing = document.createElement("div");
  typing.className = "message typing";
  typing.textContent = "Архи думает...";
  welcomeChat.appendChild(typing);
  welcomeChat.scrollTop = welcomeChat.scrollHeight;
  await new Promise(r => setTimeout(r, 1000));
  typing.remove();
  addWelcomeMessage("bot", ARCHI_INTRO);
  speak(ARCHI_INTRO);
  await new Promise(r => setTimeout(r, 400));
  welcomeActions.innerHTML = `<button class="welcome-btn primary" id="goBtn">Поехали! 🚀</button>`;
  document.getElementById("goBtn").addEventListener("click", () => {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    showLobby();
  });
});

// ── Lobby ─────────────────────────────────────────────────────────────────────
let selectedGrade = null;

function renderLobby() {
  if (!selectedGrade) renderGradeSelect();
  else renderTopicLobby(selectedGrade);
}

const ROAD_POS = [
  [46, 92], [59, 86], [64, 79], [54, 72], [40, 65],
  [48, 58], [60, 51], [51, 43], [44, 36], [50, 27], [50, 19],
];

function renderGradeSelect() {
  appDiv.classList.add("fullscreen-map");
  lobbyScreen.innerHTML = `
    <div class="grade-screen">
      <div class="grade-map-frame">
        <img class="grade-map" src="map.jpg" alt="" />
        <div class="grade-screen-title">
          <div class="grade-title-box">
            <p class="welcome-sub">Выбери свой класс</p>
          </div>
        </div>
        ${curriculum.map((g, i) => {
          const [l, t] = ROAD_POS[i] ?? [50, 50];
          return `<button class="grade-btn" data-grade="${g.grade}" style="left:${l}%;top:${t}%">${g.grade}</button>`;
        }).join("")}
      </div>
    </div>`;
  lobbyScreen.querySelectorAll(".grade-btn").forEach(btn => {
    btn.addEventListener("click", () => { selectedGrade = parseInt(btn.dataset.grade); renderTopicLobby(selectedGrade); });
  });
}

async function renderTopicLobby(gradeNum) {
  appDiv.classList.remove("fullscreen-map");
  const gradeData = curriculum.find(g => g.grade === gradeNum);
  const progress = await getProgress();
  const totalTopics = gradeData.quarters.reduce((s, q) => s + q.topics.length, 0);
  const doneTopics = gradeData.quarters.reduce((s, q) => s + q.topics.filter(t => progress.has(t.id)).length, 0);
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
            </div>`;
        }).join("")}
      </div>
    </div>`;

  lobbyScreen.querySelector(".grade-back-btn").addEventListener("click", () => { selectedGrade = null; renderGradeSelect(); });
  lobbyScreen.querySelectorAll(".quarter-header").forEach(h => h.addEventListener("click", () => h.closest(".quarter").classList.toggle("open")));
  lobbyScreen.querySelectorAll(".topic-btn").forEach(btn => {
    btn.addEventListener("click", () => showChat(btn.dataset.topicLabel, btn.dataset.topicId));
  });
}

backBtn.addEventListener("click", showLobby);

doneBtn.addEventListener("click", async () => {
  if (currentPhase === "theory") {
    currentPhase = "exercises";
    updatePhaseUI();
    await saveSession("exercises");
    addMessage("bot", "Отлично! Теперь возьми учебник и реши несколько задач на эту тему. Сфоткай решение и отправь мне — проверю вместе с тобой.");
    speak("Отлично! Теперь возьми учебник и реши несколько задач на эту тему. Сфоткай решение и отправь мне.");
    messages.push({ role: "user", content: "Переходим к заданиям из учебника." });
    return;
  }
  if (currentPhase === "exercises") {
    currentPhase = "test";
    updatePhaseUI();
    await saveSession("test");
    messages.push({ role: "user", content: "Дай мне финальное испытание — самое сложное задание на эту тему." });
    sendToAPI();
    return;
  }
  if (currentPhase === "test" || currentPhase === "done") {
    if (currentTopicId) await markCompleted(currentTopicId);
    showLobby();
  }
});

// ── TTS ───────────────────────────────────────────────────────────────────────
ttsToggle.addEventListener("click", () => {
  ttsEnabled = !ttsEnabled;
  ttsToggle.textContent = ttsEnabled ? "🔊" : "🔇";
  ttsToggle.classList.toggle("active", ttsEnabled);
  if (!ttsEnabled && currentAudio) { currentAudio.pause(); currentAudio = null; }
});

async function fetchAudio(text) {
  try {
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch { return null; }
}

function playAudio(url) {
  return new Promise(resolve => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.play();
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
  });
}

function splitIntoChunks(text, maxChars = 200) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > maxChars && current.length > 0) { chunks.push(current.trim()); current = s; }
    else { current += " " + s; }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function speak(text) {
  if (!ttsEnabled) return;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const chunks = splitIntoChunks(text, 200);
  let pendingFetch = fetchAudio(chunks[0]);
  for (let i = 0; i < chunks.length; i++) {
    if (!ttsEnabled) break;
    const url = await pendingFetch;
    if (!url || !ttsEnabled) break;
    pendingFetch = i + 1 < chunks.length ? fetchAudio(chunks[i + 1]) : null;
    await playAudio(url);
  }
}

// ── Voice input ───────────────────────────────────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.lang = "ru-RU"; recognition.continuous = true; recognition.interimResults = false;
  recognition.onresult = e => { transcript = Array.from(e.results).map(r => r[0].transcript).join(" "); };
  recognition.onend = () => {
    const text = transcript.trim(); transcript = "";
    if (isRecording) { try { recognition.start(); } catch {} return; }
    if (text) sendMessage(text);
  };
  recognition.onerror = () => { transcript = ""; stopRecording(); };
} else { micBtn.style.display = "none"; }

function startRecording() { if (!recognition || isWaiting || input.disabled) return; transcript = ""; isRecording = true; micBtn.classList.add("recording"); micBtn.textContent = "🔴"; try { recognition.start(); } catch {} }
function stopRecording() { if (!isRecording) return; isRecording = false; micBtn.classList.remove("recording"); micBtn.textContent = "🎤"; try { recognition.stop(); } catch {} }

micBtn.addEventListener("mousedown", e => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("mouseup", () => stopRecording());
micBtn.addEventListener("mouseleave", () => { if (isRecording) stopRecording(); });
micBtn.addEventListener("touchstart", e => { e.preventDefault(); startRecording(); });
micBtn.addEventListener("touchend", () => stopRecording());

// ── Photo ─────────────────────────────────────────────────────────────────────
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
    { type: "text", text: currentPhase === "exercises"
      ? "Я решил задачу из учебника. Проверь моё решение."
      : "Я написал ответ на бумаге. Прочитай что там написано и продолжай разговор как обычно." }
  ]});
  addMessage("user", "📷 Отправил фото");
  await sendToAPI();
});

// ── Chat ──────────────────────────────────────────────────────────────────────
function setControls(enabled) {
  input.disabled = !enabled; sendBtn.disabled = !enabled;
  micBtn.disabled = !enabled; photoBtn.disabled = !enabled;
}

async function sendToAPI() {
  setControls(false); isWaiting = true; showTyping();
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: apiHeaders(),
      body: JSON.stringify({ messages, topic, phase: currentPhase })
    });
    const data = await res.json();
    hideTyping();
    if (data.reply) {
      messages.push({ role: "assistant", content: data.reply });
      addMessage("bot", data.reply);
      speak(data.reply);
      saveSession(currentPhase);
      if (data.testPassed && currentPhase === "test") {
        currentPhase = "done";
        if (currentTopicId) await markCompleted(currentTopicId);
        showFinishBtn();
      }
    } else {
      addMessage("bot", "Что-то пошло не так. Попробуй ещё раз.");
    }
  } catch {
    hideTyping();
    addMessage("bot", "Не могу связаться с сервером. Проверь соединение.");
  }
  setControls(true); isWaiting = false; input.focus();
}

function showFinishBtn() {
  const btn = document.createElement("button");
  btn.className = "understood-btn";
  btn.textContent = "🎉 Вернуться к темам";
  btn.addEventListener("click", showLobby);
  chat.appendChild(btn);
  chat.scrollTop = chat.scrollHeight;
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
input.addEventListener("keydown", e => { if (e.key === "Enter") { const t = input.value.trim(); if (t) sendMessage(t); } });
