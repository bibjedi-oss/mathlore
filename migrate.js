import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data, error } = await supabase
  .from("parents")
  .select("token_balance")
  .limit(1);

if (error?.message?.includes("column") || error?.code === "42703") {
  console.log("Колонка token_balance отсутствует.");
  console.log("Выполни в Supabase SQL Editor:\n");
  console.log(`ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS token_balance BIGINT DEFAULT 50000;`);
} else {
  console.log("Колонка token_balance уже существует:", data?.[0]);
}
