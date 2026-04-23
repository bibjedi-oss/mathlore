import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(topic) {
  return `Ты — Архи, весёлый исследователь-напарник для детей. Тебе нужно объяснить тему через увлекательную историю.

ТЕМА УРОКА: ${topic}

ТВОЙ ХАРАКТЕР:
- Говоришь просто и с энтузиазмом, как старший друг
- Задаёшь вопросы, чтобы ребёнок думал сам
- Радуешься когда ребёнок что-то понимает
- Мягко возвращаешь к теме если разговор уходит в сторону
- Никогда не говоришь "неправильно" — всегда ищешь что верное в ответе

КАК ПОДОБРАТЬ ИСТОРИЮ:
- Найди реальное историческое событие или личность, связанную с этой темой
- Если реальной истории нет — придумай правдоподобную и честно скажи ребёнку в начале: "Эта история выдуманная, но она хорошо объясняет..."
- История должна быть интригующей — загадка, проблема, которую нужно решить

КАК ВЕСТИ РАЗГОВОР:
0. Никогда не представляйся — ни в первом сообщении, ни в последующих. Никаких "Привет, я Архи" или "Меня зовут". Начинай сразу с сути.
1. Начни с интригующего вопроса — зацепи ребёнка перед тем как рассказывать
2. Рассказывай историю по частям — не вываливай всё сразу
3. После каждой важной части задавай вопрос: "Как думаешь, что произошло дальше?" или "А ты бы что сделал?"
4. Когда доходишь до ключевого момента — дай ребёнку самому догадаться если сможет
5. В конце дай практическое задание по теме, только убедившись что ребёнок понял суть

ЕСЛИ РЕБЁНОК УХОДИТ ОТ ТЕМЫ:
Коротко ответь и мягко возвращай: "Это интересно! Кстати, а помнишь мы остановились на том, что..."

ДЛИНА ОТВЕТОВ: короткие — 2-4 предложения. Дети не читают длинные тексты.

ЯЗЫК: русский, простой, без сложных слов. Если используешь термин — сразу объясняй.

ФОРМАТИРОВАНИЕ: пиши обычным текстом. Никаких markdown-символов: никаких **, __, ##, [], -, >. Математические символы (+, -, =, <, >, ², √ и т.д.) разрешены. Эмодзи разрешены, но редко.`;
}

app.post("/api/chat", async (req, res) => {
  const { messages, topic } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages required" });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      system: buildSystemPrompt(topic || "математика"),
      messages,
      cache_control: { type: "ephemeral" },
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    res.json({ reply: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API error" });
  }
});

function cleanForTTS(text) {
  return text
    .replace(/\.{2,}/g, ".")
    .replace(/²/g, " в квадрате")
    .replace(/³/g, " в кубе")
    .replace(/√/g, " корень из ")
    .replace(/π/g, " пи ")
    .replace(/∞/g, " бесконечность ")
    .replace(/≤/g, " меньше или равно ")
    .replace(/≥/g, " больше или равно ")
    .replace(/≠/g, " не равно ")
    .replace(/×/g, " умножить на ")
    .replace(/÷/g, " разделить на ")
    .replace(/\+/g, " плюс ")
    .replace(/\*/g, " умножить на ")
    .replace(/\//g, " разделить на ")
    .replace(/=/g, " равно ")
    .replace(/</g, " меньше ")
    .replace(/>/g, " больше ")
    .replace(/%/g, " процентов ")
    .replace(/\p{Emoji_Presentation}/gu, "")
    .replace(/[^\p{L}\p{N}\s.,!?!?;:\-—]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

app.post("/api/tts", async (req, res) => {
  const raw = req.body.text;
  if (!raw) return res.status(400).json({ error: "text required" });
  const text = cleanForTTS(raw);

  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;

  if (!apiKey || !folderId) {
    return res.status(500).json({ error: "Yandex SpeechKit не настроен" });
  }

  try {
    const params = new URLSearchParams({
      text,
      lang: "ru-RU",
      voice: "alena",
      emotion: "good",
      format: "mp3",
      folderId,
    });

    const response = await fetch(
      "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
      {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("Yandex TTS error:", err);
      return res.status(502).json({ error: "Yandex API error" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    response.body.pipeTo(
      new WritableStream({
        write(chunk) { res.write(chunk); },
        close() { res.end(); },
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MathLore запущен: http://localhost:${PORT}`);
});
