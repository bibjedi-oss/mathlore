-- Запусти этот файл в Supabase → SQL Editor

create table if not exists parents (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,
  password_hash text not null,
  name text,
  created_at timestamptz default now()
);

create table if not exists children (
  id uuid default gen_random_uuid() primary key,
  parent_id uuid references parents(id) on delete cascade not null,
  name text not null,
  password_hash text not null,
  grade int,
  created_at timestamptz default now()
);

create table if not exists topic_sessions (
  id uuid default gen_random_uuid() primary key,
  child_id uuid references children(id) on delete cascade not null,
  topic_id text not null,
  topic_label text,
  messages jsonb not null default '[]',
  phase text not null default 'theory',
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique(child_id, topic_id)
);
