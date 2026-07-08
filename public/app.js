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
const conceptBar    = document.getElementById("conceptBar");
const logoutBtn     = document.getElementById("logoutBtn");
const headerCredits = document.getElementById("headerCredits");
const headerStars   = document.getElementById("headerStars");

// ── Контакт для оплаты (заполни перед запуском трафика) ───────────────────────
// Telegram: "https://t.me/ВАШ_USERNAME?text=..."
// WhatsApp: "https://wa.me/7XXXXXXXXXX?text=..."
const PAYMENT_CONTACT_URL = "https://t.me/bibikin";

// ── State ─────────────────────────────────────────────────────────────────────
let messages = [];
let topic = "";
let currentTopicId = null;
let currentPhase = "theory"; // theory | easy | medium | hard | test | done
let currentTasks = [];
let currentTopicStars = 9;
let currentTopicType = null;
let currentConcepts = [];
let currentTheoryImages = [];
let masteredConceptsSet = new Set();
let notebookRequested = false;
let notebookConfirmed = false;
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
let ogeWeakTopics = null;

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
  const apkUrl = window.location.origin + "/apk";
  const tgText = `ArchiMath — профиль для ${name}\nПароль: ${password}\nСкачать приложение: ${apkUrl}`;
  const tgLink = `https://t.me/share/url?url=${encodeURIComponent(apkUrl)}&text=${encodeURIComponent(`ArchiMath — профиль для ${name}\nПароль: ${password}`)}`;

  document.getElementById("welcomeModalEmoji").textContent = "🎉";
  document.getElementById("welcomeModalText").innerHTML = `
    <div style="text-align:left;font-size:14px;line-height:1.7">
      <b>Профиль создан!</b><br>
      Имя: <b>${name}</b> · Пароль: <b>${password}</b><br><br>
      Установите приложение на телефон ребёнка:
      <div style="text-align:center;margin:12px 0 4px">
        <img src="/qr.jpg" alt="QR для скачивания" style="width:140px;height:140px;border-radius:8px;border:2px solid rgba(255,208,128,0.3)" />
        <div style="font-size:11px;opacity:0.55;margin-top:4px">Наведи камеру для скачивания</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <a href="${apkUrl}" class="auth-btn" style="text-align:center;text-decoration:none;display:block">📥 Скачать APK для Android</a>
        <a href="${tgLink}" target="_blank" class="auth-btn auth-btn-secondary" style="text-align:center;text-decoration:none;display:block">✈️ Отправить ссылку в Telegram</a>
        <button id="copyApkBtn" class="auth-btn auth-btn-secondary">📋 Скопировать ссылку</button>
        <button class="auth-btn auth-btn-secondary" onclick="document.getElementById('welcomeModal').classList.add('hidden');showIphoneModal()">🍎 Инструкция для iPhone</button>
      </div>
      <small style="opacity:0.6;margin-top:10px;display:block">Данные для входа также отправлены на ваш email</small>
    </div>`;
  document.getElementById("welcomeModalBtn").textContent = "Готово";
  document.getElementById("welcomeModal").classList.remove("hidden");

  document.getElementById("copyApkBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(tgText).then(() => {
      document.getElementById("copyApkBtn").textContent = "✓ Скопировано";
    });
  });
}

// ── Achievements ─────────────────────────────────────────────────────────────
function showAchievement(emoji, title) {
  const popup = document.getElementById("achievement-popup");
  document.getElementById("ach-emoji").textContent = emoji;
  document.getElementById("ach-title").textContent = title;
  popup.classList.add("visible");
  clearTimeout(popup._t);
  popup._t = setTimeout(() => popup.classList.remove("visible"), 3500);
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
  headerStars.classList.add("hidden");
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

const TOKEN_RATE = 200 / 300_000; // ₽ за 1 токен (300к ≈ 200₽)

function tokensToRubles(tokens) { return Math.round(tokens * TOKEN_RATE); }

function updateHeaderBalance(tokens) {
  if (tokens === null || tokens === undefined) { headerCredits.classList.add("hidden"); return; }
  headerCredits.classList.remove("hidden");
  headerCredits.textContent = `🪙 ${Math.round(tokens / 1000)}к`;
  headerCredits.className = "header-credits" + (tokens <= 0 ? " hc-zero" : tokens < 75000 ? " hc-low" : "");
}

function updateHeaderStars(stars) {
  if (stars === null || stars === undefined || currentUser?.role !== "child") { headerStars.classList.add("hidden"); return; }
  headerStars.classList.remove("hidden");
  headerStars.textContent = `⭐ ${stars}`;
}

async function addStars(amount) {
  if (currentUser?.role !== "child") return;
  try {
    const res = await fetch("/api/child/stars/add", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ amount })
    });
    if (res.ok) {
      const data = await res.json();
      updateHeaderStars(data.stars);
    }
  } catch (e) { console.error("addStars error:", e); }
}

function isSpecialCourseTopic(topicId) {
  return specialCourses.some(c => c.chapters.some(ch => ch.topics.some(t => t.id === topicId)));
}

function findTopicById(id) {
  for (const grade of curriculum) {
    for (const subj of (grade.subjects || [])) {
      for (const ch of (subj.chapters || [])) {
        for (const t of (ch.topics || [])) { if (t.id === id) return t; }
      }
    }
  }
  for (const course of specialCourses) {
    for (const ch of (course.chapters || [])) {
      for (const t of (ch.topics || [])) { if (t.id === id) return t; }
    }
  }
  return null;
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
  currentTopicType = null;
  currentConcepts = [];
  currentTheoryImages = [];
  masteredConceptsSet = new Set();
  notebookRequested = false;
  notebookConfirmed = false;
  chatScreen.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  doneBtn.classList.remove("hidden");
  topicBanner.textContent = topicLabelArg;
  const bg = selectedGrade ? gradeBg(selectedGrade) : GRADE_BG[1];
  chatScreen.style.backgroundImage = `url('${bg}')`;
  fetch("/api/child/balance", { headers: apiHeaders() })
    .then(r => r.ok ? r.json() : null).then(d => updateHeaderBalance(d?.tokenBalance ?? null)).catch(() => {});
  fetch("/api/child/stars", { headers: apiHeaders() })
    .then(r => r.ok ? r.json() : null).then(d => updateHeaderStars(d?.stars ?? null)).catch(() => {});
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
    const topicData = findTopicById(topicIdArg);
    currentTopicStars = topicData?.stars ?? 9;
    currentTopicType = topicData?.type ?? null;
    currentConcepts = topicData?.concepts ?? [];
    currentTheoryImages = topicData?.theoryImages ?? [];
    renderConceptBar();
    const isMotivational = topicIdArg === "log0-1";
    if (isMotivational) {
      currentPhase = "test";
      phaseBar.classList.add("hidden");
      doneBtn.classList.add("hidden");
    } else {
      updatePhaseUI();
    }
    setControls(true);
    if (topicData?.firstMessage) {
      messages.push({ role: "user", content: "Начни." });
      messages.push({ role: "assistant", content: topicData.firstMessage });
      addMessage("bot", topicData.firstMessage);
      speak(topicData.firstMessage);
    } else {
      messages.push({ role: "user", content: "Начни историю прямо сейчас, с первого предложения. Без вступлений." });
      sendToAPI();
    }
  }
}

function renderConceptBar() {
  if (currentConcepts.length === 0) { conceptBar.classList.add("hidden"); return; }
  conceptBar.innerHTML = currentConcepts.map(c =>
    `<span class="concept-chip${masteredConceptsSet.has(c) ? " mastered" : ""}" title="${c}">${masteredConceptsSet.has(c) ? "★" : "☆"}</span>`
  ).join("");
  conceptBar.classList.toggle("hidden", currentPhase !== "theory");

  if (!notebookRequested && currentPhase === "theory" && currentConcepts.length > 0 && masteredConceptsSet.size >= currentConcepts.length) {
    notebookRequested = true;
    doneBtn.classList.add("hidden");
    const defsList = currentConcepts.map((c, i) => `${i + 1}. ${c}`).join("\n");
    const msg = `Отлично! Все концепты темы открыты 🌟\n\nВот их формальные определения — запиши в тетрадь:\n${defsList}\n\nКогда запишешь — пришли фото тетради, я проверю конспект.`;
    addMessage("bot", msg);
    messages.push({ role: "assistant", content: msg });
    speak(msg);
  }
}

function updatePhaseUI() {
  const exercisesLabel = isSpecialCourseTopic(currentTopicId) ? "Практика" : "Задания из учебника";
  const labels = { theory: "Теория", exercises: exercisesLabel, test: "Финальный тест", easy: "⭐ Лёгкий", medium: "⭐⭐ Средний", hard: "⭐⭐⭐ Сложный", done: "Завершено" };
  phaseLabel.textContent = labels[currentPhase] || "";
  phaseBar.classList.remove("hidden");
  phaseBar.className = `phase-bar phase-${currentPhase}`;
  conceptBar.classList.toggle("hidden", currentPhase !== "theory");
  const diffPhase = ["easy", "medium", "hard"].includes(currentPhase);
  if (currentPhase === "test" || currentPhase === "done" || diffPhase || (notebookRequested && !notebookConfirmed)) {
    doneBtn.classList.add("hidden");
  } else {
    doneBtn.classList.remove("hidden");
    if (currentPhase === "theory") {
      doneBtn.textContent = currentTopicType === "theory-only" ? "✓ Усвоено" : "→ Выбрать задания";
    } else {
      doneBtn.textContent = "→ Финальный тест";
    }
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
    document.getElementById("consentLabel").classList.remove("hidden");
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
document.getElementById("authPricingBtn").addEventListener("click", () => showPricingModal());

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
    document.getElementById("consentLabel").classList.toggle("hidden", parentMode !== "register");
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
  if (parentMode === "register" && !document.getElementById("consentCheck").checked) {
    errEl.textContent = "Необходимо дать согласие на обработку данных"; errEl.classList.remove("hidden"); return;
  }

  const url = parentMode === "login"
    ? "/api/auth/parent-login"
    : "/api/auth/parent-register";
  const body = parentMode === "login" ? { email, password } : { email, password, name };

  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "Ошибка"; errEl.classList.remove("hidden"); return; }
    saveToken(data.token);
    currentUser = parseToken(data.token);
    showDashboard();
    if (parentMode === "register") {
      showWelcomeModal("👋", "Добро пожаловать в ArchiMath! Добавьте ребёнка в кабинете — задайте имя и пароль для его входа. Прогресс будет виден вам здесь в любое время.", "Перейти в кабинет");
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
function closeDashMenu() {
  document.getElementById("dashMenu").classList.add("hidden");
}

document.getElementById("dashMenuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("dashMenu").classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("dashMenu");
  if (!menu.classList.contains("hidden") && !menu.contains(e.target)) {
    menu.classList.add("hidden");
  }
});

document.getElementById("dashLogoutBtn").addEventListener("click", () => { clearToken(); currentUser = null; showAuth(); });
document.getElementById("dashLogoutBtnMobile").addEventListener("click", () => { clearToken(); currentUser = null; showAuth(); });

document.getElementById("dashFeedbackBtn").addEventListener("click", () => {
  const panel = document.getElementById("dashFeedbackPanel");
  panel.classList.toggle("hidden");
});

document.getElementById("dashFeedbackBtnMobile").addEventListener("click", () => {
  closeDashMenu();
  const panel = document.getElementById("dashFeedbackPanel");
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.getElementById("dashFeedbackSend").addEventListener("click", () => {
  const text = document.getElementById("dashFeedbackText").value.trim();
  if (!text) return;
  const msg = encodeURIComponent("Отзыв об ArchiMath:\n" + text);
  window.open("https://t.me/bibikin?text=" + msg, "_blank");
  document.getElementById("dashFeedbackText").value = "";
  document.getElementById("dashFeedbackOk").classList.remove("hidden");
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

    const balance = me?.token_balance ?? null;
    const balanceRub = balance !== null ? tokensToRubles(balance) : null;
    const balanceCls = balance === null ? "" : balance <= 0 ? "dash-balance-zero" : balance < 75000 ? "dash-balance-low" : "dash-balance-ok";
    const balanceLabel = balance === null ? "" : balance <= 0
      ? `<span class="${balanceCls}">Токены закончились — <a href="#" id="buyCreditsLink">пополнить</a></span>`
      : `<span class="${balanceCls}">Токены: <b>${balance.toLocaleString("ru")}</b> <span style="color:#999;font-weight:400">(≈ ₽${balanceRub})</span></span> <a href="#" id="pricingInfoLink" class="dash-pricing-link">Как считается?</a>`;

    const balanceBar = balanceLabel
      ? `<div class="dash-balance-bar">${balanceLabel}</div>`
      : "";

    if (!children.length) {
      container.innerHTML = `
        ${balanceBar}
        <div class="dash-empty">У вас пока нет детей. Добавьте первого!</div>
        <div class="dash-add-wrap">${addChildForm()}</div>`;
      setupAddChildForm();
      setupBuyCreditsLink(container);
      setupPricingInfoLink(container);
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
    setupPricingInfoLink(container);

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
  link.addEventListener("click", e => { e.preventDefault(); showPaymentModal(); });
}

function setupPricingInfoLink(container) {
  const link = container.querySelector("#pricingInfoLink");
  if (!link) return;
  link.addEventListener("click", e => { e.preventDefault(); showPricingModal(); });
}

function showPricingModal() {
  document.getElementById("pricingModal").classList.remove("hidden");
}

function showIphoneModal() {
  document.getElementById("iphoneModal").classList.remove("hidden");
}

function showAndroidModal() {
  const apkUrl = window.location.origin + "/apk";
  const gdriveUrl = "https://drive.google.com/uc?export=download&id=1SGOtm2ZrOH9SaW_RDhLlTp10TDVFTH3t";
  document.getElementById("welcomeModalEmoji").textContent = "🤖";
  document.getElementById("welcomeModalText").innerHTML = `
    <div style="text-align:left;font-size:14px;line-height:1.7">
      <b>Установка на Android</b><br><br>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <a href="${apkUrl}" target="_blank" rel="noopener" class="auth-btn" style="text-align:center;text-decoration:none;display:block">📥 Скачать с Яндекс-диска</a>
        <a href="${gdriveUrl}" target="_blank" rel="noopener" class="auth-btn" style="text-align:center;text-decoration:none;display:block">📥 Скачать с Google Drive</a>
        <a href="https://t.me/bibikin" target="_blank" rel="noopener" class="auth-btn auth-btn-secondary" style="text-align:center;text-decoration:none;display:block">✈️ Если не получается — напишите нам в Telegram</a>
      </div>
      <div style="font-size:12px;opacity:0.6;margin-top:12px;line-height:1.5">
        После скачивания разрешите установку из неизвестных источников<br>в настройках Android.
      </div>
    </div>`;
  document.getElementById("welcomeModalBtn").textContent = "Закрыть";
  document.getElementById("welcomeModalBtn").onclick = null;
  document.getElementById("welcomeModalBtn2").style.display = "none";
  document.getElementById("welcomeModal").classList.remove("hidden");
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
  else if (!selectedGrade) { selectedGrade = 7; renderSubjectSelect(7); }
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

function isTopicUnlocked(topics, topicIndex, progress, gradeNum) {
  if (gradeNum !== undefined && (currentUser?.currentGrade ?? 1) > gradeNum) return true;
  const topic = topics[topicIndex];
  if (topicIndex === 0) {
    if (!topic.requires || topic.requires.length === 0) return true;
    return topic.requires.every(id => progress.completed.has(id));
  }
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
      ${currentUser && currentUser.grade >= 9 ? `
      <div class="oge-lobby-card" id="ogeLobbyCard">
        <div class="oge-lobby-card-inner">
          <div class="oge-lobby-emoji">📝</div>
          <div class="oge-lobby-info">
            <div class="oge-lobby-title">Подготовка к ОГЭ</div>
          </div>
          <button class="oge-lobby-btn" id="ogeLobbyBtn">${ogeWeakTopics ? "К плану →" : "Начать →"}</button>
        </div>
      </div>` : ""}
    </div>`;
  lobbyScreen.querySelectorAll(".grade-btn:not(.locked):not(.special)").forEach(btn => {
    btn.addEventListener("click", () => { selectedGrade = parseInt(btn.dataset.grade); selectedSubject = null; renderSubjectSelect(selectedGrade); });
  });
  lobbyScreen.querySelectorAll(".grade-btn.special").forEach(btn => {
    btn.addEventListener("click", () => { selectedSpecialCourse = btn.dataset.specialId; renderSpecialCourseTopics(selectedSpecialCourse); });
  });
  const ogeLobbyBtn = document.getElementById("ogeLobbyBtn");
  if (ogeLobbyBtn) {
    ogeLobbyBtn.addEventListener("click", () => {
      if (ogeWeakTopics) renderOgePrepScreen();
      else renderOgeSetup();
    });
  }
}

async function renderOgeSetup() {
  appDiv.classList.add("fullscreen-map");
  let uploadedFiles = [];

  lobbyScreen.innerHTML = `
    <div class="oge-setup-screen">
      <div class="oge-setup-header">
        <button class="cave-back-btn" id="ogeBackBtn">← Назад</button>
        <div class="oge-setup-title">Диагностика ОГЭ</div>
      </div>
      <div class="oge-setup-body">
        <div class="oge-setup-step">
          <div class="oge-step-num">1</div>
          <div class="oge-step-text">
            <b>Найди и реши вариант ОГЭ</b><br>
            Демо-варианты есть на сайте ФИПИ.<br>
            <a href="https://fipi.ru/oge" target="_blank" class="oge-fipi-link">Открыть ФИПИ →</a>
          </div>
        </div>
        <div class="oge-setup-step">
          <div class="oge-step-num">2</div>
          <div class="oge-step-text">
            <b>Сфотографируй работу</b><br>
            Загрузи фото всех листов с заданиями и все листы с твоими ответами.
          </div>
        </div>
        <div class="oge-photos-area">
          <button class="oge-add-photo-btn" id="ogeAddPhotoBtn">📷 Добавить фото</button>
          <div class="oge-thumbs" id="ogeThumbs"></div>
        </div>
        <button class="auth-btn oge-analyze-btn" id="ogeAnalyzeBtn" disabled>Анализировать</button>
        <div class="oge-analyze-hint" id="ogeAnalyzeHint">Загрузи хотя бы 1 фото</div>
      </div>
    </div>`;

  document.getElementById("ogeBackBtn").addEventListener("click", () => renderGradeSelect());

  document.getElementById("ogeAddPhotoBtn").addEventListener("click", () => {
    document.getElementById("ogePhotoInput").click();
  });

  document.getElementById("ogePhotoInput").addEventListener("change", (e) => {
    uploadedFiles = uploadedFiles.concat(Array.from(e.target.files));
    e.target.value = "";
    renderThumbs();
  });

  function renderThumbs() {
    const thumbsDiv = document.getElementById("ogeThumbs");
    const analyzeBtn = document.getElementById("ogeAnalyzeBtn");
    const hint = document.getElementById("ogeAnalyzeHint");
    if (!thumbsDiv) return;
    thumbsDiv.innerHTML = uploadedFiles.map((f, i) => `
      <div class="oge-thumb-wrap">
        <img class="oge-thumb" src="${URL.createObjectURL(f)}" />
        <button class="oge-thumb-remove" data-idx="${i}">✕</button>
      </div>`).join("");
    thumbsDiv.querySelectorAll(".oge-thumb-remove").forEach(btn => {
      btn.addEventListener("click", () => { uploadedFiles.splice(parseInt(btn.dataset.idx), 1); renderThumbs(); });
    });
    analyzeBtn.disabled = uploadedFiles.length === 0;
    hint.textContent = uploadedFiles.length > 0 ? `${uploadedFiles.length} фото загружено` : "Загрузи хотя бы 1 фото";
  }

  document.getElementById("ogeAnalyzeBtn").addEventListener("click", async () => {
    const analyzeBtn = document.getElementById("ogeAnalyzeBtn");
    const hint = document.getElementById("ogeAnalyzeHint");
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Анализирую...";
    hint.textContent = "Это займёт около минуты";
    try {
      const base64Images = await Promise.all(uploadedFiles.map(f => fileToBase64(f)));
      const mediaTypes = uploadedFiles.map(f => f.type || "image/jpeg");
      const res = await fetch("/api/child/oge-diagnostic", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ images: base64Images.map((d, i) => ({ data: d, mediaType: mediaTypes[i] })) })
      });
      if (!res.ok) throw new Error("server error");
      const data = await res.json();
      ogeWeakTopics = data.weakTopicIds;
      renderOgePrepScreen();
    } catch {
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "Анализировать";
      }
      if (hint) hint.textContent = "Ошибка. Попробуй ещё раз.";
    }
  });
}

async function renderOgePrepScreen() {
  appDiv.classList.add("fullscreen-map");
  const progress = await getProgress();

  if (!ogeWeakTopics) {
    try {
      const res = await fetch("/api/child/oge-diagnostic", { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        ogeWeakTopics = data.weakTopicIds;
      }
    } catch {}
  }

  if (!ogeWeakTopics || ogeWeakTopics.length === 0) {
    renderOgeSetup();
    return;
  }

  const weakSet = new Set(ogeWeakTopics);
  const remaining = ogeWeakTopics.filter(id => !progress.completed.has(id));

  let gradesHtml = "";
  for (const gradeData of curriculum.filter(g => g.grade >= 7 && g.grade <= 9)) {
    let subjectsHtml = "";
    for (const subj of (gradeData.subjects ?? []).filter(s => !s.hidden)) {
      let chaptersHtml = "";
      for (const ch of subj.chapters) {
        const chTopics = ch.topics.filter(t => weakSet.has(t.id));
        if (!chTopics.length) continue;
        const topicsHtml = chTopics.map(t => {
          const done = progress.completed.has(t.id);
          return `<button class="oge-topic${done ? " done" : ""}" data-id="${t.id}" data-label="${t.label}">${done ? "✓" : "🔥"} ${t.label}</button>`;
        }).join("");
        chaptersHtml += `<div class="oge-chapter"><div class="oge-chapter-title">${ch.label}</div>${topicsHtml}</div>`;
      }
      if (!chaptersHtml) continue;
      subjectsHtml += `<div class="oge-subject"><div class="oge-subject-title">${subj.label}</div>${chaptersHtml}</div>`;
    }
    if (!subjectsHtml) continue;
    gradesHtml += `<div class="oge-grade"><div class="oge-grade-title">${gradeData.grade} класс</div>${subjectsHtml}</div>`;
  }

  lobbyScreen.innerHTML = `
    <div class="oge-prep-screen">
      <div class="oge-prep-header">
        <button class="cave-back-btn" id="ogePrepBackBtn">← Карта</button>
        <div class="oge-prep-title">Подготовка к ОГЭ</div>
      </div>
      <div class="oge-prep-legend">
        <span>🔥 нужно проработать</span>
        <span>✓ пройдено</span>
      </div>
      <div class="oge-prep-topics">${gradesHtml}</div>
      <div class="oge-prep-cost">
        Примерная стоимость курса:<br>
        <b>${remaining.length} тем × ~200 ₽ ≈ ${remaining.length * 200} ₽</b>
      </div>
      <button class="auth-btn auth-btn-secondary oge-refresh-btn" id="ogeRefreshBtn">↺ Обновить диагностику</button>
    </div>`;

  document.getElementById("ogePrepBackBtn").addEventListener("click", () => renderGradeSelect());
  document.getElementById("ogeRefreshBtn").addEventListener("click", () => renderOgeSetup());

  lobbyScreen.querySelectorAll(".oge-topic").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const label = btn.dataset.label;
      const p = await getProgress();
      if (p.completed.has(id)) {
        document.getElementById("welcomeModalEmoji").textContent = "✓";
        document.getElementById("welcomeModalText").textContent = `Тема "${label}" уже пройдена. Хочешь пройти её заново?`;
        document.getElementById("welcomeModalBtn").textContent = "Пройти заново";
        const btn2 = document.getElementById("welcomeModalBtn2");
        btn2.textContent = "Отмена"; btn2.style.display = "";
        document.getElementById("welcomeModal").classList.remove("hidden");
        document.getElementById("welcomeModalBtn").onclick = () => {
          document.getElementById("welcomeModal").classList.add("hidden");
          btn2.style.display = "none"; isReplayMode = true; showChat(label, id);
        };
        btn2.onclick = () => { document.getElementById("welcomeModal").classList.add("hidden"); btn2.style.display = "none"; };
      } else {
        showChat(label, id);
      }
    });
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
                  const optBadge = t.optional ? ` <span class="optional-badge">★ необязательно</span>` : "";
                  if (!unlocked) return `<button class="topic-btn locked" disabled>🔒 ${t.label}${optBadge}</button>`;
                  if (done) return `<button class="topic-btn done" data-topic-id="${t.id}" data-topic-label="${t.label}">✓ ${t.label}${optBadge}</button>`;
                  if (resume) return `<button class="topic-btn resume" data-topic-id="${t.id}" data-topic-label="${t.label}">▶ ${t.label}${optBadge}</button>`;
                  return `<button class="topic-btn${t.optional ? " optional" : ""}" data-topic-id="${t.id}" data-topic-label="${t.label}">${t.label}${optBadge}</button>`;
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
        ${gradeData.subjects.filter(s => !s.hidden).map(s => {
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
    selectedSubject = null;
    renderSubjectSelect(selectedGrade);
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

  // Group paragraphs by chapter
  const chapterMap = new Map();
  allItems.forEach((q, qi) => {
    const ch = q.chapter || "Без главы";
    if (!chapterMap.has(ch)) chapterMap.set(ch, []);
    chapterMap.get(ch).push({ ...q, _qi: qi });
  });

  const chaptersHtml = [...chapterMap.entries()].map(([chTitle, sections]) => {
    const chDone = sections.reduce((s, q) => s + q.topics.filter(t => progress.completed.has(t.id)).length, 0);
    const chTotal = sections.reduce((s, q) => s + q.topics.length, 0);
    const chPct = Math.round(chDone / chTotal * 100);
    const chLocked = sections.every(q => q.locked || !isThemeUnlocked(gradeData.grade));

    const sectionsHtml = sections.map((q, qi) => {
      const unlocked = isThemeUnlocked(gradeData.grade) && !q.locked;
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
        <div class="cave-theme" data-qi="${q._qi}">
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
              const topicUnlocked = isTopicUnlocked(items, ti, progress, gradeData.grade);
              if (!topicUnlocked) return `<button class="topic-btn locked" disabled>🔒 ${t.label}</button>`;
              if (done) return `<button class="topic-btn done" data-topic-id="${t.id}" data-topic-label="${t.label}">✓ ${t.label}</button>`;
              if (resume) return `<button class="topic-btn resume" data-topic-id="${t.id}" data-topic-label="${t.label}">▶ ${t.label}</button>`;
              return `<button class="topic-btn" data-topic-id="${t.id}" data-topic-label="${t.label}">${t.label}</button>`;
            }).join("")}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="cave-chapter${chLocked ? " locked" : ""}">
        <div class="cave-chapter-header">
          <span class="cave-chapter-title">${chTitle}</span>
          ${chLocked
            ? `<span class="cave-panel-lock">🔒</span>`
            : `<span class="cave-chapter-progress">${chDone}/${chTotal}</span>
               <div class="cave-panel-bar cave-chapter-bar"><div class="cave-panel-fill" style="width:${chPct}%"></div></div>
               <span class="cave-chapter-arrow">▼</span>`
          }
        </div>
        ${chLocked ? "" : `<div class="cave-chapter-sections">${sectionsHtml}</div>`}
      </div>`;
  }).join("");

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
        ${chaptersHtml}
      </div>
    </div>`;

  lobbyScreen.querySelector(".cave-back-btn").addEventListener("click", () => { selectedSubject = null; renderSubjectSelect(selectedGrade); });

  lobbyScreen.querySelectorAll(".cave-chapter:not(.locked) .cave-chapter-header").forEach(h => {
    h.addEventListener("click", () => {
      const ch = h.closest(".cave-chapter");
      ch.classList.toggle("open");
      h.querySelector(".cave-chapter-arrow").textContent = ch.classList.contains("open") ? "▲" : "▼";
      if (ch.classList.contains("open")) {
        setTimeout(() => h.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    });
  });

  lobbyScreen.querySelectorAll(".cave-theme:not(.locked) .cave-theme-header").forEach(h => {
    h.addEventListener("click", e => {
      e.stopPropagation();
      const q = h.closest(".cave-theme");
      q.classList.toggle("open");
      h.querySelector(".cave-theme-arrow").textContent = q.classList.contains("open") ? "▲" : "▼";
      if (q.classList.contains("open")) {
        setTimeout(() => h.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
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
    if (currentTopicType === "theory-only") {
      showAchievement("🧠", "Тема понята!");
      if (!isReplayMode) { await saveSession("theory"); await addStars(currentTopicStars); if (currentTopicId) await markCompleted(currentTopicId); }
      showLobby();
      return;
    }
    showAchievement("🧠", "Тема понята!");
    if (!isReplayMode) { await saveSession("theory"); await addStars(currentTopicStars); }
    showDifficultySelector();
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
      body: JSON.stringify({ messages, topic, phase: currentPhase, noTextbook: isSpecialCourseTopic(currentTopicId), tasks: currentTasks, concepts: currentConcepts, theoryImages: currentTheoryImages, notebookRequested })
    });

    if (res.status === 402) {
      hideTyping();
      showTrialEndedModal();
      isWaiting = false;
      return;
    }

    const data = await res.json();
    hideTyping();
    if (data.imageDescription) {
      const imgIdx = messages.map((m, i) => ({ m, i })).reverse()
        .find(({ m }) => Array.isArray(m.content) && m.content.some(c => c.type === "image"))?.i;
      if (imgIdx !== undefined) {
        messages[imgIdx] = { role: "user", content: `[Фото задачи: ${data.imageDescription}]` };
      }
    }
    if (data.reply) {
      messages.push({ role: "assistant", content: data.reply });
      addMessage("bot", data.reply);
      speak(data.reply);
      if (data.masteredConcepts?.length > 0) {
        data.masteredConcepts.forEach(c => masteredConceptsSet.add(c));
        renderConceptBar();
      }
      if (data.notebookAccepted) {
        notebookConfirmed = true;
        showAchievement("📓", "Конспект принят!");
        doneBtn.classList.remove("hidden");
        doneBtn.textContent = currentTopicType === "theory-only" ? "✓ Усвоено" : "→ Выбрать задания";
      }
      if (data.levelPassed) {
        const icons = { easy: "⭐", medium: "⭐⭐", hard: "🏆" };
        const texts = { easy: "Лёгкий уровень пройден!", medium: "Средний уровень пройден!", hard: "Сложный уровень пройден!" };
        const starAmounts = { easy: 9, medium: 18, hard: 27 };
        showAchievement(icons[currentPhase] || "✓", texts[currentPhase] || "Уровень пройден!");
        await addStars(starAmounts[currentPhase] || 0);
        if (currentPhase === "hard") {
          currentPhase = "done";
          if (currentTopicId) await markCompleted(currentTopicId);
          showFinishBtn();
        } else {
          setTimeout(() => showDifficultySelector(), 1500);
        }
      } else if (data.testPassed && (currentPhase === "test" || currentTopicId === "log0-1")) {
        currentPhase = "done";
        if (currentTopicId) await markCompleted(currentTopicId);
        showAchievement("🏆", "Тема завершена!");
        showFinishBtn();
      } else if (!isReplayMode) {
        saveSession(currentPhase);
      }
      updateHeaderBalance(data.tokenBalance);
      if (data.tokenBalance <= 0) {
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
    <div class="modal-emoji">⏸️</div>
    <div class="modal-text">
      <b>Занятие на паузе</b><br><br>
      Сообщи родителям, что у тебя закончились токены.
    </div>`;
  modal.classList.remove("hidden");
}

function showPaymentModal() {
  const modal = document.getElementById("trialModal");
  const box = document.getElementById("trialModalBox");
  const msg = encodeURIComponent("Хочу купить подписку ArchiMath и пополнить баланс токенов");
  const contactUrl = PAYMENT_CONTACT_URL.includes("?")
    ? PAYMENT_CONTACT_URL + "&text=" + msg
    : PAYMENT_CONTACT_URL + "?text=" + msg;
  box.innerHTML = `
    <button onclick="document.getElementById('trialModal').classList.add('hidden')" style="position:absolute;top:10px;right:14px;background:none;border:none;font-size:20px;cursor:pointer;color:#888">×</button>
    <div class="modal-emoji">🪙</div>
    <div class="modal-text">
      <b>Оплата</b><br><br>
      Приложение сейчас на этапе тестирования.<br>Оплата — через менеджера.
    </div>
    <div style="text-align:center;font-size:15px;margin:12px 0;color:#5a3a00">@bibikin</div>
    <a href="${contactUrl}" target="_blank" class="auth-btn" style="text-decoration:none;display:block;text-align:center">
      Написать в Telegram →
    </a>`;
  modal.classList.remove("hidden");
}

function showDifficultySelector() {
  document.querySelectorAll(".diff-select-card").forEach(el => el.remove());
  const card = document.createElement("div");
  card.className = "diff-select-card";
  card.innerHTML = `
    <div class="diff-select-title">Выбери уровень заданий:</div>
    <button class="diff-btn diff-easy" onclick="startDifficulty('easy')">⭐ Лёгкий</button>
    <button class="diff-btn diff-medium" onclick="startDifficulty('medium')">⭐⭐ Средний</button>
    <button class="diff-btn diff-hard" onclick="startDifficulty('hard')">⭐⭐⭐ Сложный</button>
  `;
  chat.appendChild(card);
  chat.scrollTop = chat.scrollHeight;
}

async function startDifficulty(level) {
  document.querySelectorAll(".diff-select-card").forEach(el => el.remove());
  currentPhase = level;
  currentTasks = [];
  updatePhaseUI();
  if (!isReplayMode) await saveSession(level);
  try {
    const offsetKey = `archi_task_offset_${currentTopicId}_${level}`;
    const offset = parseInt(localStorage.getItem(offsetKey) || "0");
    const res = await fetch(`/api/tasks/${currentTopicId}/${level}?offset=${offset}`, { headers: apiHeaders() });
    if (res.ok) {
      const data = await res.json();
      currentTasks = data.tasks || data;
      const total = data.total ?? currentTasks.length;
      if (total > 0) localStorage.setItem(offsetKey, String((offset + 4) % total));
    }
  } catch {}
  const levelLabel = { easy: "лёгкого", medium: "среднего", hard: "сложного" }[level];
  messages = [{ role: "user", content: `Начинаем задания ${levelLabel} уровня.` }];
  sendToAPI();
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

  const hasSvg = role === "bot" && text.includes("<svg");
  const hasImg = text.includes("[img:");

  if (hasSvg || hasImg) {
    const parts = text.split(/(<svg[\s\S]*?<\/svg>|\[img:[^\]]+\])/gi);
    parts.forEach(part => {
      if (/^<svg/i.test(part)) {
        const wrap = document.createElement("div");
        wrap.className = "chat-svg";
        wrap.innerHTML = part;
        div.appendChild(wrap);
      } else if (/^\[img:/.test(part)) {
        const src = part.slice(5, -1);
        const img = document.createElement("img");
        img.src = src;
        img.className = "chat-task-img";
        img.alt = "";
        div.appendChild(img);
      } else if (part.trim()) {
        const span = document.createElement("span");
        span.textContent = part;
        div.appendChild(span);
      }
    });
  } else {
    div.textContent = text;
  }

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
  input.value = ""; input.style.height = "auto";
  await sendToAPI();
}

sendBtn.addEventListener("click", () => {
  const t = input.value.trim(); if (!t) return;
  if (isDemoMode) {
    addMessage("user", t); input.value = ""; input.style.height = "auto";
    demoMessages.push({ role: "user", content: t });
    sendDemoMessage();
  } else { sendMessage(t); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
input.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.shiftKey) return;
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isMobile) return;
  e.preventDefault();
  const t = input.value.trim(); if (!t) return;
  if (isDemoMode) {
    addMessage("user", t); input.value = ""; input.style.height = "auto";
    demoMessages.push({ role: "user", content: t });
    sendDemoMessage();
  } else { sendMessage(t); }
});
