import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Resend } from "resend";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {})
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const APP_URL = process.env.APP_URL || "https://mathlore.ru";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendEmail(to, subject, html) {
  if (!resend) return;
  try {
    await resend.emails.send({ from: "MathLore <noreply@mathlore.ru>", to, subject, html });
  } catch (err) {
    console.error("Email send error:", err.message);
  }
}

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(role) {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Не авторизован" });
    try {
      const payload = jwt.verify(auth.slice(7), JWT_SECRET);
      if (role && payload.role !== role) return res.status(403).json({ error: "Нет доступа" });
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: "Невалидный токен" });
    }
  };
}

// ── Parent auth ──────────────────────────────────────────────────────────────

app.post("/api/auth/parent-register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email и пароль обязательны" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("parents")
      .insert({ email: email.toLowerCase().trim(), password_hash: hash, name })
      .select("id, email, name")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Email уже зарегистрирован" });
      throw error;
    }
    const token = jwt.sign({ role: "parent", id: data.id, email: data.email, name: data.name }, JWT_SECRET, { expiresIn: "30d" });
    sendEmail(data.email, "Добро пожаловать в MathLore!", `
      <h2>Добро пожаловать в MathLore! 🔭</h2>
      <p>Ваш аккаунт родителя создан.</p>
      <p><b>Email:</b> ${data.email}</p>
      <p>Войдите в кабинет и добавьте ребёнка: <a href="${APP_URL}">${APP_URL}</a></p>
    `);
    res.json({ token, user: { id: data.id, email: data.email, name: data.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/auth/parent-login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email и пароль обязательны" });
  try {
    const { data, error } = await supabase
      .from("parents")
      .select("id, email, name, password_hash")
      .eq("email", email.toLowerCase().trim())
      .single();
    if (error || !data) return res.status(401).json({ error: "Неверный email или пароль" });
    const valid = await bcrypt.compare(password, data.password_hash);
    if (!valid) return res.status(401).json({ error: "Неверный email или пароль" });
    const token = jwt.sign({ role: "parent", id: data.id, email: data.email, name: data.name }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: data.id, email: data.email, name: data.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── Child auth ───────────────────────────────────────────────────────────────

app.post("/api/auth/child-login", async (req, res) => {
  const { childName, password } = req.body;
  if (!childName || !password) return res.status(400).json({ error: "Все поля обязательны" });
  try {
    const { data: child } = await supabase
      .from("children")
      .select("id, name, grade, current_grade, current_quarter, password_hash, parent_id")
      .ilike("name", childName.trim())
      .single();
    if (!child) return res.status(401).json({ error: "Имя не найдено" });

    const valid = await bcrypt.compare(password, child.password_hash);
    if (!valid) return res.status(401).json({ error: "Неверный пароль" });

    const token = jwt.sign({ role: "child", id: child.id, parentId: child.parent_id, name: child.name, grade: child.grade, currentGrade: child.current_grade ?? child.grade ?? 1, currentQuarter: child.current_quarter ?? 1 }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: child.id, name: child.name, grade: child.grade } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── Parent cabinet ───────────────────────────────────────────────────────────

app.post("/api/parent/children", requireAuth("parent"), async (req, res) => {
  const { name, password, grade, currentGrade, currentQuarter } = req.body;
  if (!name || !password) return res.status(400).json({ error: "Имя и пароль обязательны" });
  try {
    const { data: existing } = await supabase.from("children").select("id").ilike("name", name.trim()).maybeSingle();
    if (existing) return res.status(409).json({ error: "Это имя уже занято — придумайте другое или добавьте цифру" });
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("children")
      .insert({ parent_id: req.user.id, name: name.trim(), password_hash: hash, grade: grade || null, current_grade: currentGrade || grade || 1, current_quarter: currentQuarter || 1 })
      .select("id, name, grade, current_grade, current_quarter")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Ребёнок с таким именем уже добавлен" });
      throw error;
    }
    sendEmail(req.user.email, `Профиль ребёнка "${data.name}" создан`, `
      <h2>Профиль ребёнка создан 🎉</h2>
      <p><b>Имя для входа:</b> ${data.name}</p>
      <p><b>Пароль:</b> ${password}</p>
      <p>Отправьте ребёнку эту ссылку для входа: <a href="${APP_URL}">${APP_URL}</a></p>
    `);
    res.json({ ...data, password });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/parent/children", requireAuth("parent"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("children")
      .select("id, name, grade, current_grade, current_quarter, created_at")
      .eq("parent_id", req.user.id)
      .order("created_at");
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/parent/child/:id/sessions", requireAuth("parent"), async (req, res) => {
  try {
    const { data: child } = await supabase
      .from("children").select("id").eq("id", req.params.id).eq("parent_id", req.user.id).single();
    if (!child) return res.status(403).json({ error: "Нет доступа" });

    const { data, error } = await supabase
      .from("topic_sessions")
      .select("id, topic_id, topic_label, phase, created_at, completed_at")
      .eq("child_id", req.params.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/parent/child/:id/quarter-analysis", requireAuth("parent"), async (req, res) => {
  try {
    const { data: child } = await supabase
      .from("children").select("id, name").eq("id", req.params.id).eq("parent_id", req.user.id).single();
    if (!child) return res.status(403).json({ error: "Нет доступа" });

    const { quarterLabel, topicIds } = req.body;
    if (!Array.isArray(topicIds) || !topicIds.length) return res.status(400).json({ error: "topicIds обязательны" });

    const { data: sessions } = await supabase
      .from("topic_sessions")
      .select("topic_id, topic_label, phase, messages")
      .eq("child_id", req.params.id)
      .in("topic_id", topicIds);

    if (!sessions?.length) return res.json({ analysis: "По этой четверти пока нет данных для анализа." });

    const SKIP = ["Начни историю прямо сейчас, с первого предложения. Без вступлений.", "Переходим к заданиям из учебника.", "Дай мне финальное испытание — самое сложное задание на эту тему."];
    const statsText = sessions.map(s => {
      const msgs = (s.messages || []).filter(m => typeof m.content === "string" && !SKIP.includes(m.content));
      const userCount = msgs.filter(m => m.role === "user").length;
      const dialog = msgs.slice(-16).map(m => `${m.role === "user" ? "Ребёнок" : "Архи"}: ${m.content}`).join("\n");
      return `[Тема: ${s.topic_label || s.topic_id} | Стадия: ${s.phase} | Реплик ребёнка: ${userCount}]\n${dialog}`;
    }).join("\n\n---\n\n");

    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 600,
      system: "Ты анализируешь успехи ребёнка за учебную четверть по математике. Изучи диалоги с ИИ-репетитором и напиши отчёт для родителя (5-6 предложений, без markdown, без заголовков). Охвати: общий прогресс, сильные стороны, трудности, вовлечённость, рекомендации. Пиши тепло, как опытный педагог.",
      messages: [{ role: "user", content: `Ребёнок: ${child.name}\nЧетверть: ${quarterLabel}\n\n${statsText}` }]
    });
    res.json({ analysis: response.content.find(b => b.type === "text")?.text ?? "" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Ошибка сервера" }); }
});

app.post("/api/parent/child/:id/overall-analysis", requireAuth("parent"), async (req, res) => {
  try {
    const { data: child } = await supabase
      .from("children").select("id, name, grade").eq("id", req.params.id).eq("parent_id", req.user.id).single();
    if (!child) return res.status(403).json({ error: "Нет доступа" });

    const { data: sessions } = await supabase
      .from("topic_sessions")
      .select("topic_id, topic_label, phase, messages, created_at")
      .eq("child_id", req.params.id)
      .order("created_at");

    if (!sessions?.length) return res.json({ analysis: "Пока недостаточно данных. Нужно пройти хотя бы несколько тем." });

    const done = sessions.filter(s => s.phase === "done").length;
    const SKIP = ["Начни историю прямо сейчас, с первого предложения. Без вступлений.", "Переходим к заданиям из учебника.", "Дай мне финальное испытание — самое сложное задание на эту тему."];
    const statsText = sessions.map(s => {
      const msgs = (s.messages || []).filter(m => typeof m.content === "string" && !SKIP.includes(m.content));
      const userCount = msgs.filter(m => m.role === "user").length;
      const dialog = msgs.slice(-8).map(m => `${m.role === "user" ? "Ребёнок" : "Архи"}: ${m.content}`).join("\n");
      return `[${s.topic_label || s.topic_id} | ${s.phase} | реплик: ${userCount}]\n${dialog}`;
    }).join("\n\n---\n\n");

    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 800,
      system: "Ты составляешь когнитивный портрет ребёнка на основе занятий с ИИ-репетитором по математике. Напиши отчёт для родителя (6-8 предложений, без markdown, без заголовков). Включи: общий уровень и динамику, когнитивный стиль, сильные стороны, зоны роста, вовлечённость, мягкие наблюдения о внимании или настойчивости (без диагнозов), рекомендации. Пиши как опытный педагог-психолог, тепло и конструктивно.",
      messages: [{ role: "user", content: `Ребёнок: ${child.name}${child.grade ? ", " + child.grade + " класс" : ""}\nТем начато: ${sessions.length}, завершено: ${done}\n\n${statsText}` }]
    });
    res.json({ analysis: response.content.find(b => b.type === "text")?.text ?? "" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Ошибка сервера" }); }
});

app.post("/api/parent/session/:id/summary", requireAuth("parent"), async (req, res) => {
  try {
    const { data: session, error } = await supabase
      .from("topic_sessions")
      .select("topic_label, messages, phase, children!inner(parent_id)")
      .eq("id", req.params.id)
      .single();

    if (error || !session || session.children.parent_id !== req.user.id)
      return res.status(403).json({ error: "Нет доступа" });

    const msgs = session.messages || [];
    if (msgs.length < 2) return res.json({ summary: "Диалог слишком короткий для анализа." });

    const dialogText = msgs
      .filter(m => typeof m.content === "string")
      .map(m => `${m.role === "user" ? "Ребёнок" : "Архи"}: ${m.content}`)
      .join("\n");

    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 400,
      system: "Ты анализируешь диалог ребёнка с ИИ-репетитором по математике. Напиши краткий отчёт для родителя (4-5 предложений): понял ли ребёнок тему, где были трудности, насколько был вовлечён, что стоит повторить. Пиши тепло, без markdown.",
      messages: [{ role: "user", content: `Тема: ${session.topic_label}\n\n${dialogText}` }]
    });

    const summary = response.content.find(b => b.type === "text")?.text ?? "";
    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── Child progress & sessions ─────────────────────────────────────────────────

app.get("/api/progress", requireAuth("child"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("topic_sessions")
      .select("topic_id, phase")
      .eq("child_id", req.user.id);
    if (error) throw error;
    const completed = (data || []).filter(s => s.phase === "done").map(s => s.topic_id);
    const inProgress = (data || []).filter(s => s.phase !== "done").map(s => s.topic_id);
    res.json({ completed, inProgress });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/sessions/:topicId", requireAuth("child"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("topic_sessions")
      .select("topic_id, topic_label, phase, messages")
      .eq("child_id", req.user.id)
      .eq("topic_id", req.params.topicId)
      .single();
    if (error || !data) return res.status(404).json({ error: "Сессия не найдена" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/sessions", requireAuth("child"), async (req, res) => {
  const { topicId, topicLabel, messages, phase } = req.body;
  if (!topicId) return res.status(400).json({ error: "topicId обязателен" });
  try {
    const { data, error } = await supabase
      .from("topic_sessions")
      .upsert({
        child_id: req.user.id,
        topic_id: topicId,
        topic_label: topicLabel || topicId,
        messages: messages || [],
        phase: phase || "theory",
        completed_at: phase === "done" ? new Date().toISOString() : null
      }, { onConflict: "child_id,topic_id" })
      .select("id").single();
    if (error) throw error;
    res.json({ id: data.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── System prompts ────────────────────────────────────────────────────────────

function buildSystemPrompt(topic, phase) {
  const base = `ТЕМА УРОКА: ${topic}

ТВОЙ ХАРАКТЕР:
- Говоришь просто и с энтузиазмом, как старший друг
- Задаёшь вопросы, чтобы ребёнок думал сам
- Радуешься когда ребёнок что-то понимает
- Никогда не говоришь "неправильно" — всегда ищешь что верное в ответе
- Никогда не представляйся в начале

ДЛИНА ОТВЕТОВ: 2-4 предложения. Дети не читают длинные тексты.
ЯЗЫК: русский, простой.
ФОРМАТИРОВАНИЕ: обычный текст. Никаких **, ##, [], -.`;

  if (phase === "exercises") {
    return `Ты — Архи, проверяешь задания из учебника по теме: ${topic}.

Ребёнок решил задачи самостоятельно и присылает фото. Проверь ровно 3 задания:
1. Прочитай что написано на фото
2. Если верно — похвали коротко и попроси следующее задание (если ещё не 3)
3. Если ошибка — мягко укажи где, дай подсказку, не решай сам
4. После третьего проверенного задания скажи, что молодец, и предложи нажать кнопку "→ Финальный тест"

${base}`;
  }

  if (phase === "test") {
    return `Ты — Архи, проводишь финальное испытание по теме: ${topic}.

Дай ОДНО задание прямо сейчас — без вступлений. Жди ответа (фото или текст).

ВАЖНО: задание должно строго соответствовать теме "${topic}" и уровню начальной школы. Только то, что ребёнок реально мог узнать на этом уроке — никаких знаний сверх темы.

ПРАВИЛА — соблюдай строго:

1. ЗАСЧИТЫВАЙ ТОЛЬКО полностью самостоятельное и математически верное решение.
   Не засчитывай: частичные ответы, ответы с подсказками, отговорки, представления.

2. ЕСЛИ ОТВЕТ НЕВЕРНЫЙ ИЛИ НЕПОЛНЫЙ:
   - Не объясняй решение и не давай подсказок — это испытание, не урок.
   - Укажи коротко только на факт ошибки.
   - Дай НОВОЕ задание на ту же тему — другое, не повторяй предыдущее.

3. ПЕРЕРЫВ: если ребёнок ошибся 3 раза подряд — предложи перерыв.
   Скажи тепло, что устать нормально, математика требует свежей головы.
   Когда ребёнок напишет что готов продолжить — дай новое задание.

4. МАРКЕР: добавь [ТЕСТ_ПРОЙДЕН] в самый конец ответа ТОЛЬКО при полностью верном самостоятельном решении. Никогда иначе.

${base}`;
  }

  // theory (default)
  return `Ты — Архи, исследовательница-проводник для детей. Говори о себе в женском роде. Твоя задача — не объяснять математику, а вести ребёнка к тому, чтобы он открыл её сам.

${base}

МЕТОД — соблюдай строго:
Ты НИКОГДА не объясняешь математическую идею напрямую. Ты задаёшь вопросы, которые шаг за шагом ведут ребёнка к открытию. Ребёнок должен сам сформулировать вывод — не ты.

КАК НАЧАТЬ:
1. Найди реальную историческую ситуацию связанную с темой — конкретную проблему которую кому-то нужно было решить
2. Если реальной нет — придумай убедительную. Поставь [ВЫМЫСЕЛ] в самое начало, до первого слова
3. Опиши ситуацию как загадку и сразу спроси: "Как бы ты это решил?"

КАК ВЕСТИ ДИАЛОГ:
- После каждого ответа ребёнка — либо следующий наводящий вопрос, либо "Точно! И что из этого следует?"
- Никогда не говори "правильно, сейчас объясню" — продолжай только вопросами
- Если ребёнок застрял — сделай вопрос проще или конкретнее, но не давай ответ
- Если ребёнок говорит "не знаю / скажи сам" — не сдавайся, задай подсказку в форме вопроса

МОМЕНТ ОТКРЫТИЯ:
Когда ребёнок сам формулирует математическую суть — отпразднуй: "Эврика! Ты только что открыл то же самое что и [имя / люди той эпохи]!"

ПЕРЕХОД К ПРАКТИКЕ:
Только когда ребёнок своими словами объяснил суть. Спроси: "Как бы ты объяснил это другу?" — если может, понял. Тогда предложи перейти к заданиям.

ЕСЛИ РЕБЁНОК УХОДИТ ОТ ТЕМЫ: коротко ответь и мягко возвращай к теме.

`;
}

// ── Demo (no auth) ────────────────────────────────────────────────────────────

const DEMO_SYSTEM = `Ты — Архи, исследовательница-проводник для детей. Говори о себе в женском роде.
Тема демонстрации: объём и вытеснение воды. История: Архимед и корона царя Гиерона.

МЕТОД — строго:
Ты НИКОГДА не объясняешь математическую идею напрямую. Только вопросы, которые ведут к открытию.

КАК НАЧАТЬ:
Расскажи завязку: царь Гиерон заказал золотую корону, но подозревает что мастер подмешал серебро. Архимед должен это проверить — не ломая корону. Сразу спроси: "Как бы ты это проверил?"

КАК ВЕСТИ ДИАЛОГ:
- После каждого ответа — следующий наводящий вопрос или "Точно! И что из этого следует?"
- Никогда не давай готовый ответ
- Если застрял — подсказка в форме вопроса

МОМЕНТ ОТКРЫТИЯ: когда ребёнок сам приходит к идее вытеснения воды — воскликни "Эврика! Именно это крикнул Архимед!" и заверши на этом разговор. Больше вопросов не задавай.

ДЛИНА: 2-3 предложения максимум. Язык: русский, простой, дружелюбный. Никаких **, ##.`;

app.post("/api/demo", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });
  if (messages.length > 20) return res.status(400).json({ error: "demo limit reached" });
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 512,
      system: DEMO_SYSTEM,
      messages,
    });
    let text = response.content.find(b => b.type === "text")?.text?.trim() ?? "";
    const eurekaReached = text.includes("[ЭВРИКА]") || /эврика/i.test(text);
    console.log("[DEMO] eurekaReached:", eurekaReached, "| snippet:", text.slice(0, 80));
    text = text.replace(/\[ЭВРИКА\]/g, "").trim();
    res.json({ reply: text, eurekaReached });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API error" });
  }
});

// ── Chat ──────────────────────────────────────────────────────────────────────

app.post("/api/chat", requireAuth("child"), async (req, res) => {
  const { messages, topic, phase } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });
  try {
    const { data: parent } = await supabase
      .from("parents")
      .select("message_credits")
      .eq("id", req.user.parentId)
      .single();

    if (!parent || parent.message_credits <= 0) {
      return res.status(402).json({ error: "trial_ended", creditsLeft: 0 });
    }

    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: buildSystemPrompt(topic || "математика", phase || "theory"),
      messages,
    });

    const newCredits = parent.message_credits - 1;
    await supabase.from("parents").update({ message_credits: newCredits }).eq("id", req.user.parentId);

    let text = response.content.find(b => b.type === "text")?.text ?? "";
    const testPassed = text.includes("[ТЕСТ_ПРОЙДЕН]");
    text = text.replace(/\[ТЕСТ_ПРОЙДЕН\]/g, "").trim();
    const isFiction = text.startsWith("[ВЫМЫСЕЛ]");
    text = text.replace(/^\[ВЫМЫСЕЛ\]\s*/g, "");
    if (isFiction) text = "(Выдуманная история, но она хорошо объясняет тему)\n\n" + text;
    res.json({ reply: text, testPassed, creditsLeft: newCredits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API error" });
  }
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.get("/admin", (req, res) => res.sendFile("admin.html", { root: "public" }));

app.post("/api/auth/admin-login", async (req, res) => {
  const { email, password } = req.body;
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)
    return res.status(500).json({ error: "Админ не настроен" });
  if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ error: "Неверные данные" });
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

app.get("/api/admin/users", requireAuth("admin"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("parents")
      .select("id, email, name, message_credits, telegram, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/admin/leads", requireAuth("admin"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("leads")
      .select("id, telegram, source, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/admin/users/:id/credits", requireAuth("admin"), async (req, res) => {
  const { credits } = req.body;
  if (typeof credits !== "number" || credits < 0)
    return res.status(400).json({ error: "credits: число >= 0" });
  try {
    const { error } = await supabase
      .from("parents")
      .update({ message_credits: credits })
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── Feedback & leads ──────────────────────────────────────────────────────────

app.post("/api/feedback", requireAuth("child"), async (req, res) => {
  const { priceOpinion, messagesUsed } = req.body;
  try {
    await supabase.from("feedback").insert({
      parent_id: req.user.parentId,
      messages_used: messagesUsed ?? null,
      price_opinion: priceOpinion ?? ""
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/lead", async (req, res) => {
  const { telegram, source } = req.body;
  if (!telegram) return res.status(400).json({ error: "telegram required" });
  try {
    await supabase.from("leads").insert({ telegram: telegram.trim(), source: source || "demo" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/parent/telegram", requireAuth("child"), async (req, res) => {
  const { telegram } = req.body;
  if (!telegram) return res.status(400).json({ error: "telegram required" });
  try {
    await supabase.from("parents").update({ telegram: telegram.trim() }).eq("id", req.user.parentId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── TTS ───────────────────────────────────────────────────────────────────────

function cleanForTTS(text) {
  return text
    .replace(/\.{2,}/g, ".")
    .replace(/²/g, " в квадрате").replace(/³/g, " в кубе")
    .replace(/√/g, " корень из ").replace(/π/g, " пи ").replace(/∞/g, " бесконечность ")
    .replace(/≤/g, " меньше или равно ").replace(/≥/g, " больше или равно ").replace(/≠/g, " не равно ")
    .replace(/×/g, " умножить на ").replace(/÷/g, " разделить на ")
    .replace(/\+/g, " плюс ").replace(/\*/g, " умножить на ").replace(/\//g, " разделить на ")
    .replace(/=/g, " равно ").replace(/</g, " меньше ").replace(/>/g, " больше ").replace(/%/g, " процентов ")
    .replace(/\p{Emoji_Presentation}/gu, "")
    .replace(/[^\p{L}\p{N}\s.,!?;:\-—]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

app.post("/api/tts", async (req, res) => {
  const raw = req.body.text;
  if (!raw) return res.status(400).json({ error: "text required" });
  const text = cleanForTTS(raw);
  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!apiKey || !folderId) return res.status(500).json({ error: "TTS не настроен" });
  try {
    const params = new URLSearchParams({ text, lang: "ru-RU", voice: "alena", emotion: "good", format: "mp3", folderId });
    const response = await fetch("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", {
      method: "POST",
      headers: { Authorization: `Api-Key ${apiKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error("Yandex TTS error:", err);
      return res.status(502).json({ error: "Yandex API error" });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    response.body.pipeTo(new WritableStream({
      write(chunk) { res.write(chunk); },
      close() { res.end(); },
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MathLore: http://localhost:${PORT}`));
