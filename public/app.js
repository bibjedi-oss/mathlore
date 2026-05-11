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
const headerCredits = document.getElementById("headerCredits");

// ── Контакт для оплаты (заполни перед запуском трафика) ───────────────────────
// Telegram: "https://t.me/ВАШ_USERNAME?text=..."
// WhatsApp: "https://wa.me/7XXXXXXXXXX?text=..."
const PAYMENT_CONTACT_URL = "https://t.me/bibikin";

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
let selectedSubject = null;
let selectedSpecialCourse = null;

// ── Welcome modal ─────────────────────────────────────────────────────────────
function showWelcomeModal(emoji, text, btnText) {
  document.getElementById("welcomeModalEmoji").textContent = emoji;
  document.getElementById("welcomeModalText").textContent = text;
  document.getElementById("welcomeModalBtn").textContent = btnText;
  document.getElementById("welcomeModal").classList.remove("hidden");
}
document.getElementById("welcomeModalBtn").addEventListener("click", () => {
  document.getElementById("welcomeModal").classList.add("hidden");
});

function showChildCredentials(name, password) {
  const appUrl = window.location.origin;
  document.getElementById("welcomeModalEmoji").textContent = "🎉";
  document.getElementById("welcomeModalText").innerHTML = `
    <div style="text-align:left;font-size:14px;line-height:1.8">
      <b>Профиль создан!</b><br><br>
      Имя для входа: <b>${name}</b><br>
      Пароль: <b>${password}</b><br><br>
      Ссылка для ребёнка:<br>
      <a href="${appUrl}" style="color:#ffd080;word-break:break-all">${appUrl}</a><br><br>
      <small style="opacity:0.7">Письмо с этими данными отправлено на ваш email</small>
    </div>`;
  document.getElementById("welcomeModalBtn").textContent = "Понятно";
  document.getElementById("welcomeModal").classList.remove("hidden");
}

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
        return { completed: new Set(data.completed || []), inProgress: new Set(data.inProgress || []) };
      }
    } catch {}
  }
  try { return { completed: new Set(JSON.parse(localStorage.getItem(progressKey()) || "[]")), inProgress: new Set() }; }
  catch { return { completed: new Set(), inProgress: new Set() }; }
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
  isReplayMode = false;
  mainHeader.classList.remove("hidden");
  backBtn.classList.add("hidden");
  doneBtn.classList.add("hidden");
  headerCredits.classList.add("hidden");
  lobbyScreen.classList.remove("hidden");
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  renderLobby();
}

const PHASE_TRIGGERS = [
  "Начни историю прямо сейчас, с первого предложения. Без вступлений.",
  "Переходим к заданиям из учебника.",
  "Переходим к практике.",
  "Дай мне финальное испытание — самое сложное задание на эту тему."
];

function updateHeaderCredits(n) {
  if (n === null || n === undefined) { headerCredits.classList.add("hidden"); return; }
  headerCredits.classList.remove("hidden");
  headerCredits.textContent = `🪙 ${n}`;
  headerCredits.className = "header-credits" + (n <= 0 ? " hc-zero" : n < 10 ? " hc-low" : "");
}

function isSpecialCourseTopic(topicId) {
  return specialCourses.some(c => c.chapters.some(ch => ch.topics.some(t => t.id === topicId)));
}

function showChat(topicLabelArg, topicIdArg, resumeData = null) {
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
  const bg = selectedGrade ? gradeBg(selectedGrade) : GRADE_BG[1];
  chatScreen.style.backgroundImage = `url('${bg}')`;
  fetch("/api/child/balance", { headers: apiHeaders() })
    .then(r => r.ok ? r.json() : null).then(d => updateHeaderCredits(d?.credits ?? null)).catch(() => {});
  history.pushState({ screen: "chat" }, "");

  if (resumeData?.messages?.length > 0) {
    messages = resumeData.messages;
    currentPhase = resumeData.phase || "theory";
    messages.forEach(m => {
      if (m.role === "user" && PHASE_TRIGGERS.includes(m.content)) return;
      const text = typeof m.content === "string" ? m.content : "[фото]";
      addMessage(m.role === "user" ? "user" : "bot", text);
    });
    chat.scrollTop = chat.scrollHeight;
    updatePhaseUI();
    setControls(true);
  } else {
    updatePhaseUI();
    setControls(true);
    messages.push({ role: "user", content: "Начни историю прямо сейчас, с первого предложения. Без вступлений." });
    sendToAPI();
  }
}

function updatePhaseUI() {
  const exercisesLabel = isSpecialCourseTopic(currentTopicId) ? "Практика" : "Задания из учебника";
  const labels = { theory: "Теория", exercises: exercisesLabel, test: "Финальный тест", done: "Завершено" };
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

// ── Demo mode ─────────────────────────────────────────────────────────────────
let isDemoMode = false;
let isReplayMode = false;
let demoMessages = [];

async function startDemo() {
  isDemoMode = true;
  localStorage.setItem("archi_demo_seen", "1");
  hideAll();
  mainHeader.classList.remove("hidden");
  chatScreen.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  backBtn.onclick = () => { isDemoMode = false; demoMessages = []; showAuth(); backBtn.onclick = null; };
  doneBtn.classList.add("hidden");
  phaseBar.classList.add("hidden");
  topicBanner.textContent = "🔭 Демо: Архимед и корона царя";
  chatScreen.style.backgroundImage = `url('${GRADE_BG[3]}')`;
  setControls(true);
  history.replaceState(null, "", window.location.pathname);
  demoMessages = [{ role: "user", content: "Начни историю прямо сейчас, с первого предложения." }];
  await sendDemoMessage();
}

async function sendDemoMessage() {
  showTyping();
  setControls(false);
  try {
    const res = await fetch("/api/demo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: demoMessages })
    });
    const data = await res.json();
    hideTyping();
    if (data.reply) {
      demoMessages.push({ role: "assistant", content: data.reply });
      addMessage("bot", data.reply);
      speak(data.reply);
      if (data.eurekaReached) {
        setTimeout(() => {
          addMessage("bot", "Вот так и открывают настоящую математику — не зубрёжкой, а через живую задачу. Хочешь, чтобы ребёнок занимался так каждый день?");
          showDemoCTA();
        }, 1800);
        return;
      }
    }
  } catch { hideTyping(); addMessage("bot", "Нет связи с сервером."); }
  setControls(true); input.focus();
}

let demoCTAEl = null;

function showDemoCTA() {
  demoCTAEl = document.createElement("div");
  demoCTAEl.className = "demo-cta";
  chat.appendChild(demoCTAEl);
  renderDemoCTAStep1();
  chat.scrollTop = chat.scrollHeight;
}

function renderDemoCTAStep1() {
  demoCTAEl.innerHTML = `
    <div class="demo-cta-text">Хочешь заниматься так каждый день?</div>
    <input id="demoTgInput" type="text" placeholder="Ваш Telegram @username" class="demo-tg-input" />
    <button id="demoTgBtn" class="auth-btn demo-cta-btn">Оставить контакт →</button>
    <div class="demo-skip"><a href="#" id="demoSkipBtn">Пропустить</a></div>`;

  document.getElementById("demoTgBtn").addEventListener("click", async () => {
    const tg = document.getElementById("demoTgInput").value.trim();
    if (tg) {
      try {
        await fetch("/api/lead", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegram: tg, source: "demo" })
        });
      } catch {}
    }
    renderDemoCTAStep2();
  });

  document.getElementById("demoSkipBtn").addEventListener("click", e => {
    e.preventDefault();
    renderDemoCTAStep2();
  });
}

function renderDemoCTAStep2() {
  demoCTAEl.innerHTML = `
    <div class="demo-cta-text">Зарегистрируйся — первые 40 сообщений бесплатно!</div>
    <button class="auth-btn demo-cta-btn" id="demoRegisterBtn">Зарегистрироваться →</button>`;
  chat.scrollTop = chat.scrollHeight;
  document.getElementById("demoRegisterBtn").addEventListener("click", goToParentRegister);
}

function goToParentRegister() {
  isDemoMode = false;
  demoMessages = [];
  showAuth();
  authTab = "parent";
  parentMode = "register";
  document.getElementById("parentAuthPanel").classList.remove("hidden");
  document.getElementById("childAuthPanel").classList.add("hidden");
  document.getElementById("parentToggleBtn").textContent = "← Назад";
  document.getElementById("parentName").classList.remove("hidden");
  document.getElementById("parentAuthBtn").textContent = "Зарегистрироваться";
  document.querySelectorAll(".auth-mode").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === "register");
  });
}

// ── Auth screen state (must be declared before init runs) ─────────────────────
let authTab = "child";
let parentMode = "login";

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  if (window.location.hash === "#demo") { showAuth(); return; }

  if (window.location.hash === "#parent-register") {
    history.replaceState(null, "", window.location.pathname);
    showAuth();
    authTab = "parent";
    parentMode = "register";
    document.getElementById("parentAuthPanel").classList.remove("hidden");
    document.getElementById("childAuthPanel").classList.add("hidden");
    document.getElementById("parentToggleBtn").textContent = "← Назад";
    document.getElementById("parentName").classList.remove("hidden");
    document.getElementById("parentAuthBtn").textContent = "Зарегистрироваться";
    document.querySelectorAll(".auth-mode").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === "register");
    });
    return;
  }

  const saved = localStorage.getItem("mathlore_token");
  if (saved) {
    const user = parseToken(saved);
    if (user && user.exp * 1000 > Date.now()) {
      authToken = saved;
      currentUser = user;
      if (user.role === "parent") { showDashboard(); return; }
      if (user.role === "child") { showLobby(); return; }
    }
  }
  showAuth();
})();

// ── Auth screen ───────────────────────────────────────────────────────────────
document.getElementById("parentToggleBtn").addEventListener("click", () => {
  const isParent = authTab === "parent";
  authTab = isParent ? "child" : "parent";
  document.getElementById("parentAuthPanel").classList.toggle("hidden", authTab !== "parent");
  document.getElementById("childAuthPanel").classList.toggle("hidden", authTab !== "child");
  document.getElementById("parentToggleBtn").textContent = isParent ? "Вход для родителей" : "← Назад";
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
    if (parentMode === "register") {
      showWelcomeModal("👋", "Добро пожаловать в ArchiMath! Создайте профиль ребёнка — придумайте ему имя и пароль. Ребёнок сможет входить самостоятельно, а вы будете следить за его прогрессом здесь, в кабинете.", "Перейти в кабинет");
    }
  } catch {
    errEl.textContent = "Нет связи с сервером"; errEl.classList.remove("hidden");
  }
});

document.getElementById("childAuthBtn").addEventListener("click", async () => {
  const childName = document.getElementById("childName").value.trim();
  const password = document.getElementById("childPassword").value;
  const errEl = document.getElementById("childAuthError");
  errEl.classList.add("hidden");
  if (!childName || !password) { errEl.textContent = "Заполни все поля"; errEl.classList.remove("hidden"); return; }

  try {
    const res = await fetch("/api/auth/child-login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childName, password })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "Ошибка"; errEl.classList.remove("hidden"); return; }
    saveToken(data.token);
    currentUser = parseToken(data.token);
    showLobby();
    const welcomeKey = `mathlore_welcomed_${currentUser?.id}`;
    if (!localStorage.getItem(welcomeKey)) {
      localStorage.setItem(welcomeKey, "1");
      showWelcomeModal("🔭", "Привет! Я Архи — твой гид по математике. Здесь ты выбираешь тему, а я рассказываю историю о том, как её открыли — в Древней Греции, Средневековье или на заводе сто лет назад. Потом решаем задачи вместе. Поехали!", "Поехали!");
    }
  } catch {
    errEl.textContent = "Нет связи с сервером"; errEl.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => { clearToken(); currentUser = null; showAuth(); });

// ── Dashboard ─────────────────────────────────────────────────────────────────
document.getElementById("dashLogoutBtn").addEventListener("click", () => { clearToken(); currentUser = null; showAuth(); });

document.getElementById("dashFeedbackBtn").addEventListener("click", () => {
  const panel = document.getElementById("dashFeedbackPanel");
  panel.classList.toggle("hidden");
});

document.getElementById("dashFeedbackSend").addEventListener("click", async () => {
  const text = document.getElementById("dashFeedbackText").value.trim();
  if (!text) return;
  const btn = document.getElementById("dashFeedbackSend");
  btn.disabled = true; btn.textContent = "Отправляем...";
  try {
    await fetch("/api/parent/feedback", {
      method: "POST", headers: apiHeaders(),
      body: JSON.stringify({ text })
    });
  } catch {}
  document.getElementById("dashFeedbackText").value = "";
  document.getElementById("dashFeedbackOk").classList.remove("hidden");
  btn.disabled = false; btn.textContent = "Отправить";
  setTimeout(() => document.getElementById("dashFeedbackOk").classList.add("hidden"), 3000);
});

async function renderDashboard() {
  const container = document.getElementById("dashChildren");
  container.innerHTML = `<div class="dash-loading">Загружаю...</div>`;

  try {
    const [childrenRes, meRes] = await Promise.all([
      fetch("/api/parent/children", { headers: apiHeaders() }),
      fetch("/api/parent/me", { headers: apiHeaders() })
    ]);
    const children = await childrenRes.json();
    const me = meRes.ok ? await meRes.json() : null;

    const credits = me?.message_credits ?? null;
    const creditsCls = credits === null ? "" : credits <= 0 ? "dash-balance-zero" : credits < 20 ? "dash-balance-low" : "dash-balance-ok";
    const creditsLabel = credits === null ? "" : credits <= 0
      ? `<span class="${creditsCls}">Токены закончились — <a href="#" id="buyCreditsLink">получить доступ</a></span>`
      : `<span class="${creditsCls}">Токенов осталось: <b>${credits}</b></span>`;

    const balanceBar = creditsLabel
      ? `<div class="dash-balance-bar">${creditsLabel}</div>`
      : "";

    if (!children.length) {
      container.innerHTML = `
        ${balanceBar}
        <div class="dash-empty">У вас пока нет детей. Добавьте первого!</div>
        <div class="dash-add-wrap">${addChildForm()}</div>`;
      setupAddChildForm();
      setupBuyCreditsLink(container);
      return;
    }

    container.innerHTML = `
      ${balanceBar}
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
    setupBuyCreditsLink(container);

    container.querySelectorAll(".dash-progress-btn").forEach(btn => {
      btn.addEventListener("click", () => loadChildProgress(btn.dataset.id, children.find(c => c.id === btn.dataset.id)?.name));
    });
  } catch {
    container.innerHTML = `<div class="dash-error">Ошибка загрузки</div>`;
  }
}

function addChildForm() {
  const gradeOpts = [7, 8, 9].map(g => `<option value="${g}">${g} класс</option>`).join("");
  const qOpts = [1,2,3,4].map(q => `<option value="${q}">${q} четверть</option>`).join("");
  return `
    <div class="dash-add-child">
      <div class="dash-add-title">Добавить ребёнка</div>
      <input id="newChildName" class="auth-input" type="text" placeholder="Имя ребёнка" />
      <input id="newChildPassword" class="auth-input" type="text" placeholder="Пароль для входа" />
      <div class="dash-add-row">
        <select id="newChildGrade" class="auth-input dash-select"><option value="">Класс</option>${gradeOpts}</select>
        <select id="newChildQuarter" class="auth-input dash-select"><option value="">Четверть</option>${qOpts}</select>
      </div>
      <div class="dash-add-hint">Классы и четверти до выбранных будут разблокированы</div>
      <div id="addChildError" class="auth-error hidden"></div>
      <button id="addChildBtn" class="auth-btn">Добавить</button>
    </div>`;
}

function setupBuyCreditsLink(container) {
  const link = container.querySelector("#buyCreditsLink");
  if (!link) return;
  link.addEventListener("click", e => {
    e.preventDefault();
    const msg = encodeURIComponent("Хочу продолжить обучение в ArchiMath. Как оплатить доступ?");
    const url = PAYMENT_CONTACT_URL.includes("?")
      ? PAYMENT_CONTACT_URL + "&text=" + msg
      : PAYMENT_CONTACT_URL + "?text=" + msg;
    window.open(url, "_blank");
  });
}

function setupAddChildForm() {
  document.getElementById("addChildBtn").addEventListener("click", async () => {
    const btn = document.getElementById("addChildBtn");
    const name = document.getElementById("newChildName").value.trim();
    const password = document.getElementById("newChildPassword").value.trim();
    const currentGrade = parseInt(document.getElementById("newChildGrade").value) || null;
    const currentQuarter = parseInt(document.getElementById("newChildQuarter").value) || null;
    const errEl = document.getElementById("addChildError");
    errEl.classList.add("hidden");
    if (!name || !password) { errEl.textContent = "Введите имя и пароль"; errEl.classList.remove("hidden"); return; }
    btn.disabled = true; btn.textContent = "Добавляю...";
    try {
      const res = await fetch("/api/parent/children", {
        method: "POST", headers: apiHeaders(),
        body: JSON.stringify({ name, password, grade: currentGrade, currentGrade, currentQuarter })
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || "Ошибка"; errEl.classList.remove("hidden"); btn.disabled = false; btn.textContent = "Добавить"; return; }
      showChildCredentials(data.name, password);
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

    // Group sessions by theme using curriculum
    const themes = [];
    const themeMap = new Map();
    for (const s of sessions) {
      let placed = false;
      for (const grade of curriculum) {
        for (const q of (grade.themes ?? grade.quarters)) {
          if ((q.paragraphs ?? q.topics).some(t => t.id === s.topic_id)) {
            const key = `${grade.grade}-${q.id}`;
            if (!themeMap.has(key)) {
              const entry = { key, label: `${grade.label} — ${q.label}`, themeLabel: q.label, topicIds: (q.paragraphs ?? q.topics).map(t => t.id), sessions: [] };
              themeMap.set(key, entry);
              themes.push(entry);
            }
            themeMap.get(key).sessions.push(s);
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
      ${themes.map((q, qi) => `
        <div class="dash-theme-block">
          <div class="dash-theme-header">
            <span class="dash-theme-title">${q.label}</span>
            <button class="dash-theme-btn" data-qi="${qi}">📊 Анализ темы</button>
          </div>
          <div class="dash-summary-text hidden" id="dash-ta-${qi}"></div>
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

    // Анализ темы
    detail.querySelectorAll(".dash-theme-btn").forEach(btn => {
      btn.addEventListener("click", async function() {
        const qi = parseInt(btn.dataset.qi);
        const q = themes[qi];
        const el = document.getElementById(`dash-ta-${qi}`);
        btn.disabled = true; btn.textContent = "Анализирую...";
        try {
          const r = await fetch(`/api/parent/child/${childId}/quarter-analysis`, {
            method: "POST", headers: apiHeaders(),
            body: JSON.stringify({ quarterLabel: q.themeLabel, topicIds: q.topicIds })
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
  if (selectedSpecialCourse) renderSpecialCourseTopics(selectedSpecialCourse);
  else if (!selectedGrade) renderGradeSelect();
  else if (!selectedSubject) renderSubjectSelect(selectedGrade);
  else renderTopicLobby(selectedGrade, selectedSubject);
}

function isGradeUnlocked(gradeNum) {
  const cg = currentUser?.currentGrade ?? 11;
  return gradeNum <= cg;
}

function isThemeUnlocked(gradeNum) {
  const cg = currentUser?.currentGrade ?? 11;
  return gradeNum <= cg;
}

function isTopicUnlocked(topics, topicIndex, progress) {
  if (topicIndex === 0) return true;
  return progress.completed.has(topics[topicIndex - 1].id);
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

async function renderGradeSelect() {
  appDiv.classList.add("fullscreen-map");
  const progress = await getProgress();

  lobbyScreen.innerHTML = `
    <div class="grade-screen">
      <div class="grade-map-frame">
        <img class="grade-map" src="/map.webp" alt="" />
        <div class="grade-screen-title">
          <div class="grade-title-box">
            <p class="welcome-sub">Выбери свой класс</p>
          </div>
        </div>
        ${curriculum.map((g, i) => {
          const [l, t] = ROAD_POS[i] ?? [50, 50];
          const permanentlyLocked = g.locked === true;
          const unlocked = !permanentlyLocked && isGradeUnlocked(g.grade);
          const subjects = g.subjects ?? [];
          const allDone = !permanentlyLocked && subjects.length > 0 && subjects.every(s => s.chapters.every(c => c.topics.every(t => progress.completed.has(t.id))));
          const cls = !unlocked ? "grade-btn locked" : allDone ? "grade-btn done" : "grade-btn";
          const label = !unlocked ? "🔒" : allDone ? "✓" : g.grade;
          return `<button class="${cls}" data-grade="${g.grade}" style="left:${l}%;top:${t}%" ${!unlocked ? "disabled" : ""}>${label}</button>`;
        }).join("")}
        ${specialCourses.map(sc => {
          const [l, t] = sc.mapPos;
          const logicDone = specialCourses.find(c => c.id === "logic")?.chapters.every(c => c.topics.every(tp => progress.completed.has(tp.id))) ?? true;
          const locked = sc.id === "triz" && !logicDone;
          const allDone = !locked && sc.chapters.every(c => c.topics.every(tp => progress.completed.has(tp.id)));
          const cls = locked ? "grade-btn special locked" : allDone ? "grade-btn special done" : "grade-btn special";
          const lbl = locked ? "🔒" : allDone ? "✓" : sc.btnIcon;
          return `<button class="${cls}" data-special-id="${sc.id}" style="left:${l}%;top:${t}%" ${locked ? "disabled" : ""}>${lbl}</button>`;
        }).join("")}
      </div>
    </div>`;
  lobbyScreen.querySelectorAll(".grade-btn:not(.locked):not(.special)").forEach(btn => {
    btn.addEventListener("click", () => { selectedGrade = parseInt(btn.dataset.grade); selectedSubject = null; renderSubjectSelect(selectedGrade); });
  });
  lobbyScreen.querySelectorAll(".grade-btn.special").forEach(btn => {
    btn.addEventListener("click", () => { selectedSpecialCourse = btn.dataset.specialId; renderSpecialCourseTopics(selectedSpecialCourse); });
  });
}

async function renderSpecialCourseTopics(courseId) {
  appDiv.classList.add("fullscreen-map");
  const courseData = specialCourses.find(c => c.id === courseId);
  const [progress, balanceData] = await Promise.all([
    getProgress(),
    fetch("/api/child/balance", { headers: apiHeaders() }).then(r => r.ok ? r.json() : { credits: null }).catch(() => ({ credits: null }))
  ]);

  const allItems = courseData.chapters;
  const totalTopics = allItems.reduce((s, q) => s + q.topics.length, 0);
  const doneTopics = allItems.reduce((s, q) => s + q.topics.filter(t => progress.completed.has(t.id)).length, 0);
  const pct = totalTopics > 0 ? Math.round(doneTopics / totalTopics * 100) : 0;
  const credits = balanceData.credits;

  const descSeenKey = `archi_desc_seen_${courseId}`;
  const descSeen = !!localStorage.getItem(descSeenKey);

  lobbyScreen.innerHTML = `
    <div class="cave-screen">
      <img class="cave-bg" src="${courseData.bg || GRADE_BG[7]}" alt="" />
      <div class="cave-header">
        <button class="cave-back-btn">← Карта</button>
        <div class="cave-grade-title">${courseData.label}</div>
        <div class="cave-overall-progress">
          <div class="cave-overall-bar"><div class="cave-overall-fill" style="width:${pct}%"></div></div>
          <span class="cave-overall-label">${doneTopics}/${totalTopics}</span>
        </div>
        ${credits !== null ? `<div class="cave-credits ${credits <= 0 ? "cave-credits-zero" : credits < 10 ? "cave-credits-low" : ""}">${credits <= 0 ? "⚠️ Токены закончились" : `🪙 ${credits}`}</div>` : ""}
        ${courseData.description ? `<button class="course-info-btn" id="courseInfoBtn" title="Что это такое?">ℹ</button>` : ""}
      </div>
      ${courseData.description ? `
      <div class="course-desc-panel" id="courseDescPanel" ${descSeen ? 'style="display:none"' : ''}>
        <div class="course-desc-text">${courseData.description}</div>
        <button class="course-desc-close" id="courseDescClose">Понятно →</button>
      </div>` : ""}
      <div class="cave-accordion">
        ${allItems.map((q, qi) => {
          const items = q.topics;
          const qDone = items.filter(t => progress.completed.has(t.id)).length;
          const qPct = Math.round(qDone / items.length * 100);
          return `
            <div class="cave-theme" data-qi="${qi}">
              <div class="cave-theme-header">
                <span class="cave-panel-label">${q.label}</span>
                <span class="cave-panel-progress">${qDone} из ${items.length}</span>
                <div class="cave-panel-bar"><div class="cave-panel-fill" style="width:${qPct}%"></div></div>
                <span class="cave-theme-arrow">▼</span>
              </div>
              <div class="cave-theme-topics">
                ${items.map((t, ti) => {
                  const done = progress.completed.has(t.id);
                  const resume = !done && progress.inProgress.has(t.id);
                  const unlocked = isTopicUnlocked(items, ti, progress);
                  if (!unlocked) return `<button class="topic-btn locked" disabled>🔒 ${t.label}</button>`;
                  if (done) return `<button class="topic-btn done" data-topic-id="${t.id}" data-topic-label="${t.label}">✓ ${t.label}</button>`;
                  if (resume) return `<button class="topic-btn resume" data-topic-id="${t.id}" data-topic-label="${t.label}">▶ ${t.label}</button>`;
                  return `<button class="topic-btn" data-topic-id="${t.id}" data-topic-label="${t.label}">${t.label}</button>`;
                }).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;

  lobbyScreen.querySelector(".cave-back-btn").addEventListener("click", () => { selectedSpecialCourse = null; renderGradeSelect(); });

  const descPanel = lobbyScreen.querySelector("#courseDescPanel");
  const infoBtn   = lobbyScreen.querySelector("#courseInfoBtn");
  if (descPanel) {
    lobbyScreen.querySelector("#courseDescClose").addEventListener("click", () => {
      descPanel.style.display = "none";
      localStorage.setItem(descSeenKey, "1");
    });
  }
  if (infoBtn) {
    infoBtn.addEventListener("click", () => {
      if (descPanel) descPanel.style.display = descPanel.style.display === "none" ? "" : "none";
    });
  }

  lobbyScreen.querySelectorAll(".cave-theme .cave-theme-header").forEach(h => {
    h.addEventListener("click", () => {
      const q = h.closest(".cave-theme");
      q.classList.toggle("open");
      h.querySelector(".cave-theme-arrow").textContent = q.classList.contains("open") ? "▲" : "▼";
    });
  });
  lobbyScreen.querySelectorAll(".topic-btn:not(.locked)").forEach(btn => {
    btn.addEventListener("click", async () => {
      const topicId = btn.dataset.topicId;
      const topicLabel = btn.dataset.topicLabel;
      const progress = await getProgress();
      if (progress.completed.has(topicId)) {
        document.getElementById("welcomeModalEmoji").textContent = "✓";
        document.getElementById("welcomeModalText").textContent = `Тема "${topicLabel}" уже пройдена. Хочешь пройти её заново?`;
        document.getElementById("welcomeModalBtn").textContent = "Пройти заново";
        const btn2 = document.getElementById("welcomeModalBtn2");
        btn2.textContent = "Отмена";
        btn2.style.display = "";
        document.getElementById("welcomeModal").classList.remove("hidden");
        document.getElementById("welcomeModalBtn").onclick = () => {
          document.getElementById("welcomeModal").classList.add("hidden");
          btn2.style.display = "none";
          isReplayMode = true;
          showChat(topicLabel, topicId);
        };
        btn2.onclick = () => {
          document.getElementById("welcomeModal").classList.add("hidden");
          btn2.style.display = "none";
        };
        return;
      }
      if (progress.inProgress.has(topicId)) {
        showResumeModal(topicLabel, topicId);
        return;
      }
      showChat(topicLabel, topicId);
    });
  });
}

async function renderSubjectSelect(gradeNum) {
  appDiv.classList.add("fullscreen-map");
  const gradeData = curriculum.find(g => g.grade === gradeNum);
  const progress = await getProgress();

  lobbyScreen.innerHTML = `
    <div class="cave-screen">
      <img class="cave-bg" src="${gradeBg(gradeNum)}" alt="" />
      <div class="cave-header">
        <button class="cave-back-btn">← Классы</button>
        <div class="cave-grade-title">${gradeData.label}</div>
      </div>
      <div class="subject-cards">
        ${gradeData.subjects.map(s => {
          const total = s.chapters.reduce((sum, c) => sum + c.topics.length, 0);
          const done = s.chapters.reduce((sum, c) => sum + c.topics.filter(t => progress.completed.has(t.id)).length, 0);
          const pct = total > 0 ? Math.round(done / total * 100) : 0;
          return `
            <button class="subject-card" data-subject-id="${s.id}">
              <div class="subject-icon">${s.icon}</div>
              <div class="subject-label">${s.label}</div>
              <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${pct}%"></div></div>
              <div class="subject-progress-label">${done} / ${total}</div>
            </button>`;
        }).join("")}
      </div>
    </div>`;

  lobbyScreen.querySelector(".cave-back-btn").addEventListener("click", () => {
    selectedGrade = null;
    renderGradeSelect();
  });
  lobbyScreen.querySelectorAll(".subject-card").forEach(card => {
    card.addEventListener("click", () => {
      selectedSubject = card.dataset.subjectId;
      renderTopicLobby(gradeNum, selectedSubject);
    });
  });
}

const MEDIA = "https://mklrocckfuoymqvunsmr.supabase.co/storage/v1/object/public/mathlore-assets/";
const GRADE_BG = {
  1: MEDIA + "bg-1.jpg",
  2: MEDIA + "bg-2.jpg",
  3: MEDIA + "bg-3.jpg",
  4: MEDIA + "bg-4.jpg",
  7: MEDIA + "bg-7.jpg",
  8: MEDIA + "bg-8.jpg",
  9: MEDIA + "bg-9.jpg"
};
function gradeBg(gradeNum) { return GRADE_BG[gradeNum] || GRADE_BG[7]; }

async function renderTopicLobby(gradeNum, subjectId) {
  appDiv.classList.add("fullscreen-map");
  const gradeData = curriculum.find(g => g.grade === gradeNum);
  const subjectData = gradeData.subjects.find(s => s.id === subjectId);
  const [progress, balanceData] = await Promise.all([
    getProgress(),
    fetch("/api/child/balance", { headers: apiHeaders() }).then(r => r.ok ? r.json() : { credits: null }).catch(() => ({ credits: null }))
  ]);
  renderThemeMap(gradeData, subjectData, progress, balanceData.credits);
}

function renderThemeMap(gradeData, subjectData, progress, credits = null) {
  const allItems = subjectData.chapters;
  const totalTopics = allItems.reduce((s, q) => s + q.topics.length, 0);
  const doneTopics = allItems.reduce((s, q) => s + q.topics.filter(t => progress.completed.has(t.id)).length, 0);
  const pct = Math.round(doneTopics / totalTopics * 100);

  lobbyScreen.innerHTML = `
    <div class="cave-screen">
      <img class="cave-bg" src="${gradeBg(gradeData.grade)}" alt="" />
      <div class="cave-header">
        <button class="cave-back-btn">← ${gradeData.label}</button>
        <div class="cave-grade-title">${subjectData.label}</div>
        <div class="cave-overall-progress">
          <div class="cave-overall-bar"><div class="cave-overall-fill" style="width:${pct}%"></div></div>
          <span class="cave-overall-label">${doneTopics}/${totalTopics}</span>
        </div>
        ${credits !== null ? `<div class="cave-credits ${credits <= 0 ? "cave-credits-zero" : credits < 10 ? "cave-credits-low" : ""}">${credits <= 0 ? "⚠️ Токены закончились" : `🪙 ${credits}`}</div>` : ""}
      </div>
      <div class="cave-accordion">
        ${allItems.map((q, qi) => {
          const unlocked = isThemeUnlocked(gradeData.grade);
          const items = q.topics;
          const qDone = items.filter(t => progress.completed.has(t.id)).length;
          const qPct = Math.round(qDone / items.length * 100);
          if (!unlocked) {
            return `<div class="cave-theme locked">
              <div class="cave-theme-header">
                <span class="cave-panel-lock">🔒</span>
                <span class="cave-panel-label">${q.label}</span>
              </div>
            </div>`;
          }
          return `
            <div class="cave-theme" data-qi="${qi}">
              <div class="cave-theme-header">
                <span class="cave-panel-label">${q.label}</span>
                <span class="cave-panel-progress">${qDone} из ${items.length}</span>
                <div class="cave-panel-bar"><div class="cave-panel-fill" style="width:${qPct}%"></div></div>
                <span class="cave-theme-arrow">▼</span>
              </div>
              <div class="cave-theme-topics">
                ${items.map((t, ti) => {
                  const done = progress.completed.has(t.id);
                  const resume = !done && progress.inProgress.has(t.id);
                  const unlocked = isTopicUnlocked(items, ti, progress);
                  if (!unlocked) return `<button class="topic-btn locked" disabled>🔒 ${t.label}</button>`;
                  if (done) return `<button class="topic-btn done" data-topic-id="${t.id}" data-topic-label="${t.label}">✓ ${t.label}</button>`;
                  if (resume) return `<button class="topic-btn resume" data-topic-id="${t.id}" data-topic-label="${t.label}">▶ ${t.label}</button>`;
                  return `<button class="topic-btn" data-topic-id="${t.id}" data-topic-label="${t.label}">${t.label}</button>`;
                }).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;

  lobbyScreen.querySelector(".cave-back-btn").addEventListener("click", () => { selectedSubject = null; renderSubjectSelect(selectedGrade); });
  lobbyScreen.querySelectorAll(".cave-theme:not(.locked) .cave-theme-header").forEach(h => {
    h.addEventListener("click", () => {
      const q = h.closest(".cave-theme");
      q.classList.toggle("open");
      h.querySelector(".cave-theme-arrow").textContent = q.classList.contains("open") ? "▲" : "▼";
    });
  });
  lobbyScreen.querySelectorAll(".topic-btn:not(.locked)").forEach(btn => {
    btn.addEventListener("click", async () => {
      const topicId = btn.dataset.topicId;
      const topicLabel = btn.dataset.topicLabel;
      const progress = await getProgress();
      if (progress.completed.has(topicId)) {
        document.getElementById("welcomeModalEmoji").textContent = "✓";
        document.getElementById("welcomeModalText").textContent = `Тема "${topicLabel}" уже пройдена. Хочешь пройти её заново?`;
        document.getElementById("welcomeModalBtn").textContent = "Пройти заново";
        const btn2 = document.getElementById("welcomeModalBtn2");
        btn2.textContent = "Отмена";
        btn2.style.display = "";
        document.getElementById("welcomeModal").classList.remove("hidden");
        document.getElementById("welcomeModalBtn").onclick = () => {
          document.getElementById("welcomeModal").classList.add("hidden");
          btn2.style.display = "none";
          isReplayMode = true;
          showChat(topicLabel, topicId);
        };
        btn2.onclick = () => {
          document.getElementById("welcomeModal").classList.add("hidden");
          btn2.style.display = "none";
        };
        return;
      }
      if (progress.inProgress.has(topicId)) {
        showResumeModal(topicLabel, topicId);
        return;
      }
      showChat(topicLabel, topicId);
    });
  });
}

backBtn.addEventListener("click", async () => {
  if (!isDemoMode && !isReplayMode && messages.length > 0 && currentTopicId && currentPhase !== "done") {
    await saveSession(currentPhase);
  }
  showLobby();
});

window.addEventListener("popstate", async () => {
  if (!chatScreen.classList.contains("hidden")) {
    if (!isDemoMode && !isReplayMode && messages.length > 0 && currentTopicId && currentPhase !== "done") {
      await saveSession(currentPhase);
    }
    showLobby();
  }
});

doneBtn.addEventListener("click", async () => {
  if (currentPhase === "theory") {
    currentPhase = "exercises";
    updatePhaseUI();
    if (!isReplayMode) await saveSession("exercises");
    if (isSpecialCourseTopic(currentTopicId)) {
      // Новая сессия API — история теории не передаётся
      messages = [{ role: "user", content: "Переходим к практике." }];
      sendToAPI();
    } else {
      addMessage("bot", "Отлично! Теперь возьми учебник и реши несколько задач на эту тему. Сфоткай решение и отправь мне — проверю вместе с тобой.");
      speak("Отлично! Теперь возьми учебник и реши несколько задач на эту тему. Сфоткай решение и отправь мне.");
      // Новая сессия API — история теории не передаётся
      messages = [{ role: "user", content: "Переходим к заданиям из учебника." }];
    }
    return;
  }
  if (currentPhase === "exercises") {
    currentPhase = "test";
    updatePhaseUI();
    if (!isReplayMode) await saveSession("test");
    // Новая сессия API — история упражнений не передаётся
    messages = [{ role: "user", content: "Дай мне финальное испытание — самое сложное задание на эту тему." }];
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
      ? (isSpecialCourseTopic(currentTopicId) ? "Я написал ответ на задачу. Прочитай и проверь." : "Я решил задачу из учебника. Проверь моё решение.")
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
      body: JSON.stringify({ messages, topic, phase: currentPhase, noTextbook: isSpecialCourseTopic(currentTopicId) })
    });

    if (res.status === 402) {
      hideTyping();
      showTrialEndedModal();
      isWaiting = false;
      return;
    }

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
      } else if (!isReplayMode) {
        saveSession(currentPhase);
      }
      updateHeaderCredits(data.creditsLeft);
      if (data.creditsLeft === 0) {
        showTrialEndedModal();
        return;
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

function showTrialEndedModal() {
  setControls(false);
  const modal = document.getElementById("trialModal");
  const box = document.getElementById("trialModalBox");
  box.innerHTML = `
    <div class="modal-emoji">🎉</div>
    <div class="modal-text"><b>Пробный период завершён</b><br><br>Ваш ребёнок отправил 40 сообщений Архи.<br><br>Один вопрос:</div>
    <div style="font-weight:600;color:#333;font-size:15px">Сколько бы вы заплатили за доступ на месяц?</div>
    <textarea id="priceInput" class="modal-textarea" placeholder="Ваш ответ..."></textarea>
    <button id="submitFeedbackBtn" class="auth-btn">Ответить →</button>`;
  modal.classList.remove("hidden");

  document.getElementById("submitFeedbackBtn").addEventListener("click", async () => {
    const opinion = document.getElementById("priceInput").value.trim();
    const btn = document.getElementById("submitFeedbackBtn");
    btn.disabled = true; btn.textContent = "Сохраняем...";
    try {
      await fetch("/api/feedback", {
        method: "POST", headers: apiHeaders(),
        body: JSON.stringify({ priceOpinion: opinion, messagesUsed: 40 })
      });
    } catch {}
    showTrialTgStep(box);
  });
}

function showTrialTgStep(box) {
  box.innerHTML = `
    <div class="modal-emoji">📱</div>
    <div class="modal-text"><b>Оставьте Telegram</b><br><br>Напишем лично — договоримся о продолжении.</div>
    <input id="trialTgInput" type="text" placeholder="@username" class="modal-textarea" style="min-height:auto;padding:12px 14px" />
    <button id="trialTgBtn" class="auth-btn">Оставить контакт →</button>
    <div style="text-align:center;margin-top:4px">
      <a href="#" id="trialTgSkip" style="font-size:13px;color:#aaa;text-decoration:none">Пропустить</a>
    </div>`;

  async function submitTg() {
    const tg = document.getElementById("trialTgInput")?.value?.trim();
    if (tg) {
      try {
        await fetch("/api/parent/telegram", {
          method: "POST", headers: apiHeaders(),
          body: JSON.stringify({ telegram: tg })
        });
      } catch {}
    }
    showTrialCommunityLinks(box);
  }

  document.getElementById("trialTgBtn").addEventListener("click", submitTg);
  document.getElementById("trialTgSkip").addEventListener("click", e => { e.preventDefault(); showTrialCommunityLinks(box); });
}

function showTrialCommunityLinks(box) {
  const msg = encodeURIComponent("Хочу продолжить обучение в ArchiMath. Как оплатить доступ?");
  const contactUrl = PAYMENT_CONTACT_URL.includes("?")
    ? PAYMENT_CONTACT_URL + "&text=" + msg
    : PAYMENT_CONTACT_URL + "?text=" + msg;
  box.innerHTML = `
    <div class="modal-emoji">🔓</div>
    <div class="modal-text"><b>Спасибо за ответ!</b><br><br>Чтобы продолжить занятия — напишите нам. Ответим в течение дня и активируем доступ.</div>
    <a href="${contactUrl}" target="_blank" class="auth-btn" style="text-decoration:none;display:block;text-align:center">Написать →</a>
    <div style="text-align:center;margin-top:12px;font-size:13px;color:#888">или вступайте в сообщество:</div>
    <div class="modal-community-links">
      <a href="https://t.me/+TlWWAQ8-mn02MDUy" target="_blank" style="font-size:13px;color:#8b5e1a">Telegram</a>
      <a href="https://max.ru/join/qcb5TNldItcA9c0NokfaxHXATyFcRn00QdJMA6gZYwk" target="_blank" style="font-size:13px;color:#8b5e1a">Max</a>
    </div>`;
}

function showFinishBtn() {
  const btn = document.createElement("button");
  btn.className = "understood-btn";
  btn.textContent = "🎉 Вернуться к темам";
  btn.addEventListener("click", showLobby);
  chat.appendChild(btn);
  chat.scrollTop = chat.scrollHeight;
}

function showResumeModal(topicLabel, topicId) {
  document.getElementById("welcomeModalEmoji").textContent = "▶️";
  document.getElementById("welcomeModalText").textContent = `Продолжить тему "${topicLabel}" с того места?`;
  document.getElementById("welcomeModalBtn").textContent = "Продолжить";
  const btn2 = document.getElementById("welcomeModalBtn2");
  btn2.textContent = "Начать заново";
  btn2.style.display = "";
  document.getElementById("welcomeModal").classList.remove("hidden");

  document.getElementById("welcomeModalBtn").onclick = async () => {
    document.getElementById("welcomeModal").classList.add("hidden");
    btn2.style.display = "none";
    await resumeSession(topicLabel, topicId);
  };
  btn2.onclick = () => {
    document.getElementById("welcomeModal").classList.add("hidden");
    btn2.style.display = "none";
    showChat(topicLabel, topicId);
  };
}

async function resumeSession(topicLabel, topicId) {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(topicId)}`, { headers: apiHeaders() });
    if (!res.ok) { showChat(topicLabel, topicId); return; }
    const session = await res.json();
    showChat(topicLabel, topicId, { messages: session.messages || [], phase: session.phase });
  } catch {
    showChat(topicLabel, topicId);
  }
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

sendBtn.addEventListener("click", () => {
  const t = input.value.trim(); if (!t) return;
  if (isDemoMode) {
    addMessage("user", t); input.value = "";
    demoMessages.push({ role: "user", content: t });
    sendDemoMessage();
  } else { sendMessage(t); }
});
input.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const t = input.value.trim(); if (!t) return;
  if (isDemoMode) {
    addMessage("user", t); input.value = "";
    demoMessages.push({ role: "user", content: t });
    sendDemoMessage();
  } else { sendMessage(t); }
});
