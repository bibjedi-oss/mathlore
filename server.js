import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

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
  const { parentEmail, childName, password } = req.body;
  if (!parentEmail || !childName || !password) return res.status(400).json({ error: "Все поля обязательны" });
  try {
    const { data: parent } = await supabase
      .from("parents")
      .select("id")
      .eq("email", parentEmail.toLowerCase().trim())
      .single();
    if (!parent) return res.status(401).json({ error: "Родитель не найден" });

    const { data: child } = await supabase
      .from("children")
      .select("id, name, grade, password_hash")
      .eq("parent_id", parent.id)
      .ilike("name", childName.trim())
      .single();
    if (!child) return res.status(401).json({ error: "Ребёнок не найден" });

    const valid = await bcrypt.compare(password, child.password_hash);
    if (!valid) return res.status(401).json({ error: "Неверный пароль" });

    const token = jwt.sign({ role: "child", id: child.id, parentId: parent.id, name: child.name, grade: child.grade }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: child.id, name: child.name, grade: child.grade } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── Parent cabinet ───────────────────────────────────────────────────────────

app.post("/api/parent/children", requireAuth("parent"), async (req, res) => {
  const { name, password, grade } = req.body;
  if (!name || !password) return res.status(400).json({ error: "Имя и пароль обязательны" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("children")
      .insert({ parent_id: req.user.id, name: name.trim(), password_hash: hash, grade: grade || null })
      .select("id, name, grade")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Ребёнок с таким именем уже добавлен" });
      throw error;
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/parent/children", requireAuth("parent"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("children")
      .select("id, name, grade, created_at")
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
    res.json({ completed });
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

Ребёнок решил задачи и присылает фото. Твои действия:
1. Прочитай что написано на фото
2. Если верно — похвали коротко и попроси следующее
3. Если ошибка — мягко укажи где, дай подсказку, не решай сам

${base}`;
  }

  if (phase === "test") {
    return `Ты — Архи, проводишь финальное испытание по теме: ${topic}.

Дай ОДНО сложное задание прямо сейчас — без вступлений. Жди ответа (фото или текст).
После ответа: если верно — поздравь с прохождением темы! Если ошибка — разбери её и дай ещё один шанс.

${base}`;
  }

  // theory (default)
  return `Ты — Архи, весёлый исследователь-напарник для детей. Объясни тему через увлекательную историю.

${base}

КАК ПОДОБРАТЬ ИСТОРИЮ:
- Найди реальное историческое событие или личность, связанную с темой
- Если реальной истории нет — придумай и честно скажи: "Эта история выдуманная, но она хорошо объясняет..."
- История должна быть интригующей — загадка или проблема, которую надо решить

КАК ВЕСТИ РАЗГОВОР:
1. Начни с истории — с первого предложения, без вступлений
2. Рассказывай по частям, задавай вопросы
3. В конце дай практическое задание только убедившись что ребёнок понял суть

ЕСЛИ РЕБЁНОК УХОДИТ ОТ ТЕМЫ: коротко ответь и мягко возвращай к теме.

`;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const { messages, topic, phase } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: buildSystemPrompt(topic || "математика", phase || "theory"),
      messages,
    });
    const text = response.content.find(b => b.type === "text")?.text ?? "";
    res.json({ reply: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API error" });
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
