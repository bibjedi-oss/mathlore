// ── DOM ──────────────────────────────────────────────────────────────────────
const appDiv        = document.querySelector(".app");
const authScreen    = document.getElementById("authScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const mainHeader    = document.getElementById("mainHeader");
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
let selectedGrade = null;

// ── Auth helpers ──────────────────────────────────────────────────────────────
function saveToken(token) {
  authToken = token;
  localStorage.setItem("mathlore_token", token);
}
function clearToken() {
  authToken = null;
  localStorage.removeItem("mathlore_token");
  localStorage.removeItem("mathlore_progress");
}
function parseToken(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}
function apiHeaders() {
  return { "Content-Type": "application/json", ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) };
}

// ── Progress (DB for children, localStorage fallback) ─────────────────────────
function progressKey() {
  return `mathlore_progress_${currentUser?.id || "guest"}`;
}

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
  try { return new Set(JSON.parse(localStorage.getItem(progressKey()) || "[]")); }
  catch { return new Set(); }
}
async function markCompleted(id) {
  if (currentUser?.role === "child") {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ topicId: id, topicLabel: topic, messages: stripImages(messages), phase: "done" })
      });
      if (!res.ok) console.error("markCompleted HTTP error:", res.status, await res.text());
      else console.log("markCompleted OK:", id);
    } catch (e) { console.error("markCompleted exception:", e); }
  }
  const p = JSON.parse(localStorage.getItem(progressKey()) || "[]");
  if (!p.includes(id)) { p.push(id); localStorage.setItem(progressKey(), JSON.stringify(p)); }
}
function stripImages(msgs) {
  return msgs.map(m => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content
        .filter(b => b.type !== "image")
        .map(b => b.type === "text" ? b.text : b)
        .join(" ") || "[фото]"
    };
  });
}

async function saveSession(phase) {
  if (!currentUser || currentUser.role !== "child" || !currentTopicId) {
    console.warn("saveSession skipped: no user/child/topicId", { currentUser, currentTopicId });
    return;
  }
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ topicId: currentTopicId, topicLabel: topic, messages: stripImages(messages), phase })
    });
    if (!res.ok) console.error("saveSession HTTP error:", res.status, await res.text());
    else console.log("saveSession OK:", phase, currentTopicId);
  } catch (e) { console.error("saveSession exception:", e); }
}

// ── Screen routing ─────────────────────────────────────────────────────────────
function hideAll() {
  authScreen.classList.add("hidden");
  dashboardScreen.classList.add("hidden");
  mainHeader.classList.add("hidden");
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

function showLobby() {
  hideAll();
  mainHeader.classList.remove("hidden");
  backBtn.classList.add("hidden");
  doneBtn.classList.add("hidden");
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
      if (payload.role === "child") { showLobby(); return; }
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
    showLobby();
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

    const phaseLabels = { theory: "Теория", exercises: "Задания", test: "Тест", done: "✓ Завершено" };

    // Group sessions by quarter using curriculum
    const quarters = [];
    const quarterMap = new Map();
    for (const s of sessions) {
      let placed = false;
      for (const grade of curriculum) {
        for (const q of grade.quarters) {
          if (q.topics.some(t => t.id === s.topic_id)) {
            const key = `${grade.grade}-${q.id}`;
            if (!quarterMap.has(key)) {
              const entry = { key, label: `${grade.label} — ${q.label}`, quarterLabel: q.label, topicIds: q.topics.map(t => t.id), sessions: [] };
              quarterMap.set(key, entry);
              quarters.push(entry);
            }
            quarterMap.get(key).sessions.push(s);
            placed = true; break;
          }
        }
        if (placed) break;
      }
    }

    detail.innerHTML = `
      <div class="dash-detail-title">${childName}</div>
      <button class="dash-overall-btn">🧠 Общий портрет</button>
      <div class="dash-summary-text hidden" id="dash-overall-text"></div>
      ${quarters.map((q, qi) => `
        <div class="dash-quarter-block">
          <div class="dash-quarter-header">
            <span class="dash-quarter-title">${q.label}</span>
            <button class="dash-quarter-btn" data-qi="${qi}">📊 Анализ четверти</button>
          </div>
          <div class="dash-summary-text hidden" id="dash-qa-${qi}"></div>
          <div class="dash-sessions">
            ${q.sessions.map(s => `
              <div class="dash-session ${s.phase === "done" ? "done" : ""}">
                <div class="dash-session-topic">${s.topic_label || s.topic_id}</div>
                <div class="dash-session-phase">${phaseLabels[s.phase] || s.phase}</div>
                ${s.phase === "done" ? `<button class="dash-summary-btn" data-session="${s.id}">AI-анализ темы</button>` : ""}
                <div class="dash-summary-text hidden" id="summary-${s.id}"></div>
              </div>`).join("")}
          </div>
        </div>`).join("")}`;

    // Общий портрет
    detail.querySelector(".dash-overall-btn").addEventListener("click", async function() {
      const btn = this;
      const el = document.getElementById("dash-overall-text");
      btn.disabled = true; btn.textContent = "Анализирую...";
      try {
        const r = await fetch(`/api/parent/child/${childId}/overall-analysis`, { method: "POST", headers: apiHeaders() });
        const data = await r.json();
        el.textContent = data.analysis || "Нет данных";
        el.classList.remove("hidden");
        btn.style.display = "none";
      } catch { btn.textContent = "Ошибка"; btn.disabled = false; }
    });

    // Анализ четверти
    detail.querySelectorAll(".dash-quarter-btn").forEach(btn => {
      btn.addEventListener("click", async function() {
        const qi = parseInt(btn.dataset.qi);
        const q = quarters[qi];
        const el = document.getElementById(`dash-qa-${qi}`);
        btn.disabled = true; btn.textContent = "Анализирую...";
        try {
          const r = await fetch(`/api/parent/child/${childId}/quarter-analysis`, {
            method: "POST", headers: apiHeaders(),
            body: JSON.stringify({ quarterLabel: q.quarterLabel, topicIds: q.topicIds })
          });
          const data = await r.json();
          el.textContent = data.analysis || "Нет данных";
          el.classList.remove("hidden");
          btn.style.display = "none";
        } catch { btn.textContent = "Ошибка"; btn.disabled = false; }
      });
    });

    // Анализ темы
    detail.querySelectorAll(".dash-summary-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sessionId = btn.dataset.session;
        const el = document.getElementById(`summary-${sessionId}`);
        btn.disabled = true; btn.textContent = "Анализирую...";
        try {
          const r = await fetch(`/api/parent/session/${sessionId}/summary`, { method: "POST", headers: apiHeaders() });
          const data = await r.json();
          el.textContent = data.summary || "Нет данных";
          el.classList.remove("hidden");
          btn.style.display = "none";
        } catch { btn.textContent = "Ошибка"; btn.disabled = false; }
      });
    });

  } catch {
    detail.innerHTML = `<div class="dash-error">Ошибка загрузки</div>`;
  }
}

// ── Lobby ─────────────────────────────────────────────────────────────────────
function renderLobby() {
  if (!selectedGrade) renderGradeSelect();
  else renderTopicLobby(selectedGrade);
}

const ROAD_POS = [
  [49, 92], // 1
  [51, 86], // 2
  [60, 79], // 3
  [53, 72], // 4
  [64, 65], // 5
  [50, 58], // 6
  [47, 51], // 7
  [46, 43], // 8
  [45, 36], // 9
  [70, 27], // 10
  [40, 19], // 11
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

const ttsLoading = document.getElementById("ttsLoading");

async function speak(text) {
  if (!ttsEnabled) return;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const chunks = splitIntoChunks(text, 200);
  ttsLoading.classList.remove("hidden");
  let pendingFetch = fetchAudio(chunks[0]);
  for (let i = 0; i < chunks.length; i++) {
    if (!ttsEnabled) break;
    const url = await pendingFetch;
    ttsLoading.classList.add("hidden");
    if (!url || !ttsEnabled) break;
    pendingFetch = i + 1 < chunks.length ? fetchAudio(chunks[i + 1]) : null;
    await playAudio(url);
  }
  ttsLoading.classList.add("hidden");
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
      if (data.testPassed && currentPhase === "test") {
        currentPhase = "done";
        if (currentTopicId) await markCompleted(currentTopicId);
        showFinishBtn();
      } else {
        saveSession(currentPhase);
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
