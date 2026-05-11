import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Проверяем наличие колонки token_balance
const { data, error } = await supabase
  .from("parents")
  .select("token_balance")
  .limit(1);

if (error?.message?.includes("column") || error?.code === "42703") {
  console.log("Колонка token_balance отсутствует.");
  console.log("Выполни в Supabase SQL Editor:");
  console.log(`
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS token_balance NUMERIC(10,4) DEFAULT 200;

-- Перенести старые кредиты как рубли (1 кредит = 3₽, примерная конвертация)
UPDATE parents
  SET token_balance = COALESCE(message_credits, 0) * 3
  WHERE token_balance IS NULL OR token_balance = 0;
  `);
} else {
  console.log("Колонка token_balance уже существует:", data?.[0]);
}
