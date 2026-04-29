create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  title text not null,
  host_name text not null,
  status text not null default 'lobby',
  phase text not null default 'lobby',
  current_question_index integer not null default -1,
  question_started_at timestamptz,
  reveal_at timestamptz,
  questions_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  display_name text not null,
  score integer not null default 0,
  joined_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  question_id text not null,
  question_index integer not null,
  answer_text text not null,
  is_correct boolean,
  response_ms integer,
  points_awarded integer not null default 0,
  answered_at timestamptz not null default now(),
  unique (game_id, player_id, question_index)
);

create index if not exists idx_players_game_id on public.players(game_id);
create index if not exists idx_answers_game_question on public.answers(game_id, question_index);
create index if not exists idx_answers_player on public.answers(player_id);

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;

drop policy if exists "anon can read games" on public.games;
drop policy if exists "anon can write games" on public.games;
drop policy if exists "anon can read players" on public.players;
drop policy if exists "anon can write players" on public.players;
drop policy if exists "anon can read answers" on public.answers;
drop policy if exists "anon can write answers" on public.answers;

create policy "anon can read games"
on public.games for select
to anon
using (true);

create policy "anon can write games"
on public.games for all
to anon
using (true)
with check (true);

create policy "anon can read players"
on public.players for select
to anon
using (true);

create policy "anon can write players"
on public.players for all
to anon
using (true)
with check (true);

create policy "anon can read answers"
on public.answers for select
to anon
using (true);

create policy "anon can write answers"
on public.answers for all
to anon
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_rel rel
    join pg_class cls on cls.oid = rel.prrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    join pg_publication pub on pub.oid = rel.prpubid
    where pub.pubname = 'supabase_realtime'
      and nsp.nspname = 'public'
      and cls.relname = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1
    from pg_publication_rel rel
    join pg_class cls on cls.oid = rel.prrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    join pg_publication pub on pub.oid = rel.prpubid
    where pub.pubname = 'supabase_realtime'
      and nsp.nspname = 'public'
      and cls.relname = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1
    from pg_publication_rel rel
    join pg_class cls on cls.oid = rel.prrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    join pg_publication pub on pub.oid = rel.prpubid
    where pub.pubname = 'supabase_realtime'
      and nsp.nspname = 'public'
      and cls.relname = 'answers'
  ) then
    alter publication supabase_realtime add table public.answers;
  end if;
end $$;
