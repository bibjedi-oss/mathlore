import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

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

let currentModel = process.env.DEFAULT_MODEL || "claude-opus-4-6";

// Курс токенов: 1 токен = TOKEN_RATE ₽ (блендированный, Opus ×2 при 90₽/$)
const TOKEN_RATE = 200 / 300_000; // ₽ за 1 токен (300к ≈ 200₽)
const TRIAL_TOKENS = 300_000; // ≈ 200₽ при старте

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendEmail(to, subject, html) {
  if (!resend) return;
  try {
    await resend.emails.send({ from: "ArchiMath <noreply@mathlore.ru>", to, subject, html });
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
  return res.status(403).json({ error: "Регистрация временно закрыта" });
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email и пароль обязательны" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("parents")
      .insert({ email: email.toLowerCase().trim(), password_hash: hash, name, token_balance: TRIAL_TOKENS })
      .select("id, email, name")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Email уже зарегистрирован" });
      throw error;
    }
    const token = jwt.sign({ role: "parent", id: data.id, email: data.email, name: data.name }, JWT_SECRET, { expiresIn: "30d" });
    sendEmail(data.email, "Добро пожаловать в ArchiMath!", `
      <h2>Добро пожаловать в ArchiMath! 🔭</h2>
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

app.get("/api/parent/me", requireAuth("parent"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("parents")
      .select("id, name, email, token_balance")
      .eq("id", req.user.id)
      .single();
    if (error) throw error;
    res.json({ ...data, token_balance: data.token_balance ?? TRIAL_TOKENS });
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

    const SKIP = ["Начни историю прямо сейчас, с первого предложения. Без вступлений.", "Переходим к заданиям из учебника.", "Переходим к практике.", "Дай мне финальное испытание — самое сложное задание на эту тему."];
    const statsText = sessions.map(s => {
      const msgs = (s.messages || []).filter(m => typeof m.content === "string" && !SKIP.includes(m.content));
      const userCount = msgs.filter(m => m.role === "user").length;
      const dialog = msgs.slice(-16).map(m => `${m.role === "user" ? "Ребёнок" : "Архи"}: ${m.content}`).join("\n");
      return `[Тема: ${s.topic_label || s.topic_id} | Стадия: ${s.phase} | Реплик ребёнка: ${userCount}]\n${dialog}`;
    }).join("\n\n---\n\n");

    const response = await anthropic.messages.create({
      model: currentModel,
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
    const SKIP = ["Начни историю прямо сейчас, с первого предложения. Без вступлений.", "Переходим к заданиям из учебника.", "Переходим к практике.", "Дай мне финальное испытание — самое сложное задание на эту тему."];
    const statsText = sessions.map(s => {
      const msgs = (s.messages || []).filter(m => typeof m.content === "string" && !SKIP.includes(m.content));
      const userCount = msgs.filter(m => m.role === "user").length;
      const dialog = msgs.slice(-8).map(m => `${m.role === "user" ? "Ребёнок" : "Архи"}: ${m.content}`).join("\n");
      return `[${s.topic_label || s.topic_id} | ${s.phase} | реплик: ${userCount}]\n${dialog}`;
    }).join("\n\n---\n\n");

    const response = await anthropic.messages.create({
      model: currentModel,
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
      model: currentModel,
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

// ── OGE Diagnostic ────────────────────────────────────────────────────────────

const OGE_CATEGORIES = {
  "Алгебраические выражения и тождества": ["7-1-1","7-2-1","7-2-2","7-2-3","7-2-4","7-3-1","7-3-2","7-3-3","7-3-4"],
  "Линейные уравнения и функции":         ["7-1-2","7-1-3","7-1-4","7-1-5","7-1-6"],
  "Системы линейных уравнений":           ["7-4-1","7-4-2","7-4-3","7-4-4"],
  "Вероятность и статистика":             ["7-9-1","7-9-2","7-9-3","7-9-4","7-9-5","9-5-1","9-5-2"],
  "Начальная геометрия и параллельные прямые": ["7-5-1","7-5-2","7-7-1","7-7-2"],
  "Треугольники":                         ["7-6-1","7-6-2","7-6-3","7-8-1","7-8-2","7-8-3"],
  "Рациональные дроби":                   ["8-1-1","8-1-2","8-1-3","8-1-4"],
  "Квадратные корни":                     ["8-2-1","8-2-2","8-2-3"],
  "Квадратные уравнения":                 ["8-3-1","8-3-2","8-3-3","8-3-4"],
  "Неравенства":                          ["8-4-1","8-4-2","8-4-3"],
  "Квадратичная функция":                 ["8-4-4","9-1-1","9-1-2","9-1-3"],
  "Степени":                              ["8-4-5","9-4-1","9-4-2"],
  "Четырёхугольники":                     ["8-5-1","8-5-2","8-5-3","8-5-4","8-5-5"],
  "Площади и теорема Пифагора":           ["8-6-1","8-6-2"],
  "Подобие треугольников":                ["8-7-1","8-7-2","8-7-3"],
  "Окружность":                           ["8-8-1","8-8-2","8-8-3","8-8-4"],
  "Прогрессии":                           ["9-3-1","9-3-2"],
  "Уравнения высших степеней и системы":  ["9-2-1","9-2-2"],
  "Тригонометрия":                        ["9-8-1","9-8-2","9-8-3"],
  "Координаты и векторы":                 ["9-6-1","9-6-2","9-6-3","9-7-1","9-7-2"],
  "Правильные многоугольники и длина окружности": ["9-9-1","9-9-2"],
};

app.post("/api/child/oge-diagnostic", requireAuth("child"), async (req, res) => {
  const { images } = req.body;
  if (!Array.isArray(images) || !images.length) return res.status(400).json({ error: "Нет фотографий" });
  const imgs = images.slice(0, 6);
  const categoryNames = Object.keys(OGE_CATEGORIES);
  const content = [
    ...imgs.map(img => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.startsWith("data:image/png") ? "image/png" : "image/jpeg",
        data: img.replace(/^data:image\/[a-z]+;base64,/, "")
      }
    })),
    {
      type: "text",
      text: `На фотографиях — выполненная контрольная работа по математике (уровень ОГЭ, 7–9 класс). Определи, в каких из следующих тем ученик допустил ошибки или не справился с заданиями:\n${categoryNames.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nВерни строго JSON: {"weak": ["название темы 1", "название темы 2"]}. Если ошибок нет — {"weak": []}. Только JSON, без пояснений.`
    }
  ];
  try {
    const response = await anthropic.messages.create({ model: currentModel, max_tokens: 400, messages: [{ role: "user", content }] });
    const text = response.content.find(b => b.type === "text")?.text ?? "{}";
    let weakCategories = [];
    try { weakCategories = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}").weak ?? []; } catch {}
    const weakTopicIds = [...new Set(weakCategories.flatMap(cat => OGE_CATEGORIES[cat] ?? []))];
    await supabase.from("oge_diagnostics").upsert(
      { child_id: req.user.id, weak_topic_ids: weakTopicIds, updated_at: new Date() },
      { onConflict: "child_id" }
    );
    res.json({ weakTopicIds, weakCategories });
  } catch (err) { console.error(err); res.status(500).json({ error: "Ошибка анализа" }); }
});

app.get("/api/child/oge-diagnostic", requireAuth("child"), async (req, res) => {
  try {
    const { data } = await supabase.from("oge_diagnostics")
      .select("weak_topic_ids, updated_at").eq("child_id", req.user.id).maybeSingle();
    res.json(data ? { weakTopicIds: data.weak_topic_ids, updatedAt: data.updated_at } : { weakTopicIds: null });
  } catch (err) { res.status(500).json({ error: "Ошибка сервера" }); }
});

// ── Child progress & sessions ─────────────────────────────────────────────────

app.get("/api/child/balance", requireAuth("child"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("parents")
      .select("token_balance")
      .eq("id", req.user.parentId)
      .single();
    if (error) throw error;
    res.json({ tokenBalance: data.token_balance ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/child/stars", requireAuth("child"), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("children")
      .select("stars")
      .eq("id", req.user.id)
      .single();
    if (error) throw error;
    res.json({ stars: data.stars ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/child/stars/add", requireAuth("child"), async (req, res) => {
  const amount = parseInt(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: "Некорректное количество звёзд" });
  try {
    const { data: child, error: fetchErr } = await supabase
      .from("children")
      .select("stars")
      .eq("id", req.user.id)
      .single();
    if (fetchErr) throw fetchErr;
    const newStars = (child.stars ?? 0) + amount;
    const { error: updateErr } = await supabase
      .from("children")
      .update({ stars: newStars })
      .eq("id", req.user.id);
    if (updateErr) throw updateErr;
    res.json({ stars: newStars });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

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

function buildMotivationalPrompt() {
  return `Ты — Архи. Ты проводишь вводный разговор перед курсом логики. Говори о себе в женском роде.

Твоя цель — не объяснять логику, а помочь ученику самому почувствовать, зачем она ему нужна лично.

ШАГ 1. Узнай, что важно.
Спроси: чего он хочет в жизни? Что для него важно — учёба, карьера, хобби, деньги, отношения, игры, спорт? Задай вопрос прямо с первой реплики.

ШАГ 2. Копни глубже.
После ответа уточни: "А почему это важно? Что за этим стоит?" Найди настоящее желание под поверхностным.

ШАГ 3. Покажи конкретную связь с логикой.
Когда понял, что реально важно ученику — объясни честно, как логическое мышление помогает именно в этом.
Примеры (адаптируй под его ответ):
- Хочет денег → логика защищает от манипуляций, помогает просчитывать решения
- Хочет в IT/игры → логика — основа программирования и стратегии
- Хочет нравиться людям → логика помогает говорить убедительно и не попадать в ловушки споров
- Хочет хорошо учиться → логика делает любой предмет понятнее, потому что учит видеть структуру
Не говори абстрактно "логика помогает думать" — только конкретные примеры под его запрос.

ШАГ 4. Завершение.
Когда ученик проявил интерес ("да", "окей", "звучит интересно", "попробуем") — скажи тепло одну фразу о том что его ждёт, и добавь [ТЕСТ_ПРОЙДЕН] в самый конец ответа.

СТИЛЬ:
- Говоришь просто и по-дружески, без пафоса и рекламных клише
- 2-4 предложения за ход
- Обычный текст, никакого markdown, никаких **, ##
- Никогда не говоришь "неправильно"`;
}

function buildSystemPrompt(topic, phase, grade = 7, noTextbook = false, tasks = [], concepts = [], theoryImages = []) {
  if (topic === "Зачем мне логика?") return buildMotivationalPrompt();
  const isConsolidation = topic.startsWith("Закрепление");
  const isGeometry = /геометр|треугольник|окружност|угол|прямоугольник|параллелограмм|трапеци|ромб|теорем|теорема|вектор|координат|площадь|периметр|конус|цилиндр|пирамид|сфер|куб|призм/i.test(topic);

  const svgHint = isGeometry ? `
ЧЕРТЕЖИ: если объяснение требует геометрической иллюстрации — вставь SVG прямо в ответ (без markdown-обёртки):
- Атрибуты тега svg: viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg"
- Теги: line, circle, rect, polygon, path, text
- Стиль линий: stroke="#4a2c08" stroke-width="2" fill="none"
- Стиль текста: fill="#333" font-size="13" font-family="sans-serif"
- Вспомогательные линии: stroke="#bbb" stroke-dasharray="4"
- Подписывай ключевые точки и углы
- Одно сообщение — максимум один SVG` : "";

  const base = `ТЕМА УРОКА: ${topic}
КЛАСС: ${grade}

ТВОЙ ХАРАКТЕР:
- Говоришь просто и с энтузиазмом, как старший друг
- Радуешься когда ребёнок что-то понимает
- Никогда не говоришь "неправильно" — всегда ищешь что верное в ответе
- Никогда не представляйся в начале

ДЛИНА ОТВЕТОВ: 2-4 предложения. Дети не читают длинные тексты.
ЯЗЫК: русский, простой, соответствующий ${grade} классу.
ФОРМАТИРОВАНИЕ: обычный текст. Никаких **, ##, [], -.${svgHint}

ЗАПРЕТ: никогда не объясняй понятие через само себя. Объясняя "большие числа" — не используй большие числа. Объясняя "дроби" — не используй дроби. Используй только то, что ребёнок уже точно знает: знакомые предметы, бытовые ситуации.

БЕЗОПАСНОСТЬ: никогда не предлагай ребёнку физически что-либо делать со своим телом (трогать, считать части тела и т.п.) или с предметами вокруг для проверки математической идеи. Только воображаемые примеры.`;

  if (phase === "easy" || phase === "medium" || phase === "hard") {
    const levelName = { easy: "лёгкого", medium: "среднего", hard: "сложного" }[phase];
    const tasksList = tasks.length > 0
      ? `Задания для этого уровня — давай строго по очереди:\n${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : `Придумай 4 задания ${levelName} уровня по теме "${topic}" для ${grade} класса.`;
    return `Ты — Архи, проводишь задания ${levelName} уровня по теме: ${topic} (${grade} класс).

${tasksList}

ПРАВИЛА — соблюдай строго:
1. Начни с первого задания прямо сейчас — без вступлений
2. Верный ответ → коротко похвали (1 предложение) → следующее задание
3. Ошибка → мягко укажи где, дай подсказку уровня ${grade} класса, жди повтора. Не решай сам.
4. После верного ответа на последнее (4-е) задание — напиши короткую похвалу и добавь [УРОВЕНЬ_ПРОЙДЕН] в самый конец

${base}`;
  }

  if (phase === "exercises") {
    if (noTextbook) {
      return `Ты — Архи, проводишь практику по теме: ${topic}.

Дай ребёнку ровно 3 задачи по очереди — одну за другой:
1. Сформулируй первую задачу прямо сейчас — без вступлений
2. Жди ответа (текст или фото)
3. Если верно — коротко похвали и дай следующую задачу
4. Если ошибка — мягко укажи где, дай подсказку, не решай сам
5. После третьей задачи скажи что молодец, напомни нажать "→ Финальный тест"

Задачи должны строго соответствовать теме "${topic}" — практические, без учебника.

${base}`;
    }
    return `Ты — Архи, проверяешь задания из учебника по теме: ${topic} (${grade} класс).

Ребёнок решил задачи самостоятельно и присылает фото или пишет ответ. Проверь ровно 3 задания:
1. Читай что написано на фото или в тексте
2. Если верно — похвали коротко и попроси следующее задание (если ещё не 3)
3. Если ошибка — мягко укажи где, дай подсказку уровня ${grade} класса, не решай сам
4. После третьего проверенного задания скажи, что молодец, и напомни нажать кнопку "→ Финальный тест"

${base}`;
  }

  if (phase === "test") {
    return `Ты — Архи, проводишь финальное испытание по теме: ${topic} (${grade} класс).

Дай ОДНО задание прямо сейчас — без вступлений. Жди ответа (фото или текст).

ВАЖНО: задание должно строго соответствовать теме "${topic}" и точно соответствовать уровню ${grade} класса. Только то, что ребёнок реально мог узнать на этом уроке — никаких знаний сверх темы.

ПРАВИЛА — соблюдай строго:

1. ЗАСЧИТЫВАЙ ТОЛЬКО полностью самостоятельное и математически верное решение.
   Не засчитывай: частичные ответы, ответы с подсказками, отговорки, пересказы.

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

  // Закрепление — итоговая задача по всей теме
  if (isConsolidation) {
    return `Ты — Архи, проводишь итоговое закрепление темы.

Тема для закрепления: ${topic.replace("Закрепление: ", "")}

Дай ОДНУ задачу, которая объединяет всё пройденное в этой теме. Задача должна:
- Требовать применения нескольких понятий из темы сразу
- Строго соответствовать уровню ${grade} класса
- Быть решаемой без знаний за пределами этой темы

После верного ответа скажи коротко что именно молодец применил, и добавь [ТЕСТ_ПРОЙДЕН] в конец.
Если ошибка — дай короткую подсказку уровня ${grade} класса и жди повторной попытки.

${base}`;
  }

  // theory
  return `Ты — Архи, исследовательница-проводник для детей. Говори о себе в женском роде. Твоя задача — не объяснять математику, а вести ребёнка к тому, чтобы он открыл её сам.

${base}

МЕТОД — соблюдай строго:
Ты НИКОГДА не объясняешь математическую идею напрямую. Ты задаёшь вопросы, которые шаг за шагом ведут ребёнка к открытию. Ребёнок должен сам сформулировать вывод — не ты.

КАК НАЧАТЬ:
1. Найди реальную историческую ситуацию, связанную с темой — конкретную проблему, которую кому-то нужно было решить в эпоху, соответствующую ${grade} классу (7 класс — Античность и Средневековье, 8 класс — арабская математика и Ренессанс, 9 класс — Эпоха Просвещения и XIX век)
2. Если реальной нет — придумай убедительную. Поставь [ВЫМЫСЕЛ] в самое начало, до первого слова
3. Опиши ситуацию как загадку и сразу спроси: "Как бы ты это решил?"

КАК ВЕСТИ ДИАЛОГ:
- Задавай конкретные вопросы — не абстрактные "почему?", а про ситуацию: "что произойдёт если..."
- После каждого ответа ребёнка — либо следующий наводящий вопрос, либо "Точно! И что из этого следует?"
- Никогда не говори "правильно, сейчас объясню" — продолжай только вопросами
- Если ребёнок застрял — сделай вопрос проще или конкретнее, но не давай ответ
- Если ребёнок говорит "не знаю / скажи сам" — не сдавайся, задай подсказку в форме вопроса

ТЕМП: к 4-5 реплике ребёнка должно произойти открытие. Если не происходит — упрощай вопросы, не затягивай.

МОМЕНТ ОТКРЫТИЯ:
Когда ребёнок сам формулирует математическую суть — отпразднуй: "Эврика! Ты только что открыл то же самое что и [имя / люди той эпохи]!"

ПЕРЕХОД К ПРАКТИКЕ:
Только когда ребёнок своими словами объяснил суть, напомни: "Попробуй объяснить другу за одно предложение?" — если может, понял. Тогда скажи: "Отлично! Теперь нажми кнопку → Задания вверху — порешаем настоящие задачи."

ЕСЛИ РЕБЁНОК УХОДИТ ОТ ТЕМЫ: коротко ответь и мягко возвращай к теме.

${concepts.length > 0 ? `КОНЦЕПТЫ ДЛЯ ОСВОЕНИЯ:
Ребёнок должен открыть следующие понятия в ходе диалога:
${concepts.map((c, i) => `${i + 1}. ${c}`).join("\n")}

МАРКЕР КОНЦЕПТА: когда ребёнок своими словами формулирует понятие из списка — добавь в самый конец своего сообщения на отдельной строке:
[КОНЦЕПТ_ОСВОЕН: <точный текст понятия из списка выше>]
Ставь маркер только один раз для каждого понятия. Только когда ребёнок реально его сформулировал — не раньше.` : ""}

${notebookRequested && concepts.length > 0 ? `ПРОВЕРКА КОНСПЕКТА:
Ученик уже открыл все концепты темы и записал их в тетрадь. Он прислал фото тетради.
Убедись, что все эти понятия записаны верно:
${concepts.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Если все понятия записаны корректно — добавь в самый конец ответа на отдельной строке: [КОНСПЕКТ_ПРИНЯТ]
Если есть ошибки или пропуски — укажи конкретно что нужно исправить или дописать, и попроси прислать исправленное фото.` : ""}

${theoryImages.length > 0 ? `ИЛЛЮСТРАЦИИ ИЗ УЧЕБНИКА:
Для этой темы доступны рисунки из учебника. Когда картинка поможет ребёнку лучше понять идею — вставь её в своё сообщение тегом [img:/img/tasks/FILENAME]. Не вставляй все сразу — только ту, что нужна прямо сейчас.
${theoryImages.map(img => `• ${img.src} — ${img.hint}`).join("\n")}` : ""}
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

МОМЕНТ ОТКРЫТИЯ: когда ребёнок сам приходит к идее вытеснения воды — воскликни "Эврика! Именно это крикнул Архимед!" и сразу в конце добавь маркер [ЭВРИКА]. Больше вопросов не задавай, разговор завершён.

ДЛИНА: 2-3 предложения максимум. Язык: русский, простой, дружелюбный. Никаких **, ##.`;

app.post("/api/demo", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });
  if (messages.length > 20) return res.status(400).json({ error: "demo limit reached" });
  try {
    const response = await anthropic.messages.create({
      model: currentModel,
      max_tokens: 512,
      system: DEMO_SYSTEM,
      messages,
    });
    let text = response.content.find(b => b.type === "text")?.text?.trim() ?? "";
    const eurekaReached = text.includes("[ЭВРИКА]");
    console.log("[DEMO] eurekaReached:", eurekaReached, "| snippet:", text.slice(0, 80));
    text = text.replace(/\[ЭВРИКА\]/g, "").trim();
    res.json({ reply: text, eurekaReached });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API error" });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get("/api/tasks/:topicId/:difficulty", requireAuth("child"), async (req, res) => {
  const { topicId, difficulty } = req.params;
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  if (!["easy", "medium", "hard"].includes(difficulty))
    return res.status(400).json({ error: "Invalid difficulty" });
  try {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, task_text")
      .eq("topic_id", topicId)
      .eq("difficulty", difficulty)
      .order("order_num");
    if (error) throw error;
    const all = data || [];
    const total = all.length;
    if (total === 0) return res.json({ tasks: [], total: 0 });
    const tasks = [];
    for (let i = 0; i < 4; i++) tasks.push(all[(offset + i) % total].task_text);
    res.json({ tasks, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ── Chat ──────────────────────────────────────────────────────────────────────

app.post("/api/chat", requireAuth("child"), async (req, res) => {
  const { messages, topic, phase, noTextbook, tasks, concepts, theoryImages, notebookRequested = false } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });
  try {
    const { data: parent } = await supabase
      .from("parents")
      .select("token_balance")
      .eq("id", req.user.parentId)
      .single();

    if (!parent || (parent.token_balance ?? 0) <= 0) {
      return res.status(402).json({ error: "trial_ended", tokenBalance: 0 });
    }

    const response = await anthropic.messages.create({
      model: currentModel,
      max_tokens: 1024,
      system: buildSystemPrompt(topic || "математика", phase || "theory", req.user.currentGrade ?? 11, !!noTextbook, Array.isArray(tasks) ? tasks : [], Array.isArray(concepts) ? concepts : [], Array.isArray(theoryImages) ? theoryImages : []),
      messages,
    });

    let totalTokens = response.usage.input_tokens + response.usage.output_tokens;

    // Если в сообщениях есть изображение — получаем его текстовое описание,
    // чтобы клиент заменил картинку текстом и не тащил её в каждый следующий запрос
    let imageDescription = null;
    const imageMsg = [...messages].reverse().find(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === "image")
    );
    if (imageMsg) {
      const imageBlock = imageMsg.content.find(c => c.type === "image");
      const descResponse = await anthropic.messages.create({
        model: currentModel,
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            imageBlock,
            { type: "text", text: "Перепиши содержимое изображения лаконично, без потери смыслов. Если это математическая задача — перепиши полностью всё условие, все числа, формулы и вопрос. Если есть чертёж, схема или таблица — опиши их структуру и все данные. Не сокращай ничего важного." }
          ]
        }]
      });
      imageDescription = descResponse.content[0]?.text ?? null;
      totalTokens += descResponse.usage.input_tokens + descResponse.usage.output_tokens;
    }

    const newBalance = Math.max(0, (parent.token_balance || 0) - totalTokens);
    await supabase.from("parents").update({ token_balance: newBalance }).eq("id", req.user.parentId);

    let text = response.content.find(b => b.type === "text")?.text ?? "";
    const testPassed = text.includes("[ТЕСТ_ПРОЙДЕН]");
    const levelPassed = text.includes("[УРОВЕНЬ_ПРОЙДЕН]");
    const notebookAccepted = text.includes("[КОНСПЕКТ_ПРИНЯТ]");
    const masteredConcepts = [];
    const conceptMatches = [...text.matchAll(/\[КОНЦЕПТ_ОСВОЕН:\s*([^\]]+)\]/g)];
    conceptMatches.forEach(m => masteredConcepts.push(m[1].trim()));
    text = text.replace(/\[ТЕСТ_ПРОЙДЕН\]/g, "").replace(/\[УРОВЕНЬ_ПРОЙДЕН\]/g, "").replace(/\[КОНЦЕПТ_ОСВОЕН:[^\]]+\]/g, "").replace(/\[КОНСПЕКТ_ПРИНЯТ\]/g, "").trim();
    const isFiction = text.startsWith("[ВЫМЫСЕЛ]");
    text = text.replace(/^\[ВЫМЫСЕЛ\]\s*/g, "");
    if (isFiction) text = "(Выдуманная история, но она хорошо объясняет тему)\n\n" + text;
    res.json({ reply: text, testPassed, levelPassed, masteredConcepts, notebookAccepted, tokenBalance: newBalance, imageDescription });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API error" });
  }
});

// ── Admin ─────────────────────────────────────────────────────────────────────

app.get("/admin",   (req, res) => res.sendFile("admin.html",   { root: "public" }));
app.get("/privacy", (req, res) => res.sendFile("privacy.html", { root: "public" }));
app.get("/landing", (req, res) => res.sendFile("landing.html", { root: "public" }));
app.get("/health", (req, res) => res.json({ ok: true }));
const APK_YANDEX = process.env.APK_YANDEX_URL || "https://disk.yandex.ru/d/OiQUbqBAu0tW4A";
app.get("/apk", async (req, res) => {
  try {
    const r = await fetch(`https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(APK_YANDEX)}`);
    const d = await r.json();
    if (d.href) return res.redirect(d.href);
    res.status(404).send("APK временно недоступен");
  } catch {
    res.status(500).send("Ошибка получения ссылки");
  }
});
app.get("/demo",    (req, res) => res.sendFile("demo.html",    { root: "public" }));
app.get("/app",     (req, res) => res.sendFile("index.html",   { root: "public" }));
app.get("/logic",   (req, res) => res.sendFile("index.html",   { root: "public" }));

// Если LANDING_AS_HOME=true в env — лендинг на /, приложение только на /app
// Если не задано (по умолчанию) — приложение на /, лендинг на /landing
app.get("/", (req, res) => {
  if (process.env.LANDING_AS_HOME === "true") {
    res.sendFile("landing.html", { root: "public" });
  } else {
    res.sendFile("index.html", { root: "public" });
  }
});

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
      .select("id, email, name, token_balance, telegram, notes, created_at")
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
  const { credits, add } = req.body;
  try {
    if (typeof add === "number" && add > 0) {
      const { data: parent } = await supabase.from("parents").select("token_balance").eq("id", req.params.id).single();
      const current = parent?.token_balance || 0;
      const { error } = await supabase.from("parents").update({ token_balance: current + add }).eq("id", req.params.id);
      if (error) throw error;
      return res.json({ ok: true, newBalance: current + add });
    }
    if (typeof credits === "number" && credits >= 0) {
      const { error } = await supabase.from("parents").update({ token_balance: credits }).eq("id", req.params.id);
      if (error) throw error;
      return res.json({ ok: true, newBalance: credits });
    }
    res.status(400).json({ error: "Укажите credits (установить) или add (добавить)" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/admin/users/:id/notes", requireAuth("admin"), async (req, res) => {
  const { notes } = req.body;
  if (typeof notes !== "string") return res.status(400).json({ error: "notes required" });
  try {
    const { error } = await supabase.from("parents").update({ notes: notes.trim().slice(0, 500) }).eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/admin/model", requireAuth("admin"), (req, res) => {
  res.json({ model: currentModel });
});

app.post("/api/admin/model", requireAuth("admin"), (req, res) => {
  const ALLOWED = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-7"];
  const { model } = req.body;
  if (!ALLOWED.includes(model)) return res.status(400).json({ error: "Недопустимая модель" });
  currentModel = model;
  console.log("[ADMIN] Model switched to:", currentModel);
  res.json({ ok: true, model: currentModel });
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

app.post("/api/parent/feedback", requireAuth("parent"), async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== "string" || !text.trim())
    return res.status(400).json({ error: "text required" });
  try {
    await supabase.from("feedback").insert({
      parent_id: req.user.id,
      price_opinion: text.trim().slice(0, 2000)
    });
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

async function seedTasks() {
  try {
    const seed = JSON.parse(readFileSync(join(__dirname, "tasks-seed.json"), "utf8"));
    const topicIds = [...new Set(seed.map(t => t.topic_id))];
    for (const topicId of topicIds) {
      const { count } = await supabase
        .from("tasks").select("*", { count: "exact", head: true }).eq("topic_id", topicId);
      if (!count) {
        const tasks = seed.filter(t => t.topic_id === topicId);
        const { error } = await supabase.from("tasks").insert(tasks);
        if (error) console.error(`Seed error [${topicId}]:`, error.message);
        else console.log(`Seeded ${tasks.length} tasks for ${topicId}`);
      }
    }
  } catch (e) {
    console.error("seedTasks error:", e.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`MathLore: http://localhost:${PORT}`);
  await seedTasks();
});
