-- Migration: 005_sessions.sql
-- Cloud session history with RLS and cascade deletion

create table if not exists public.sessions (
    id text primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    profile text not null default 'interview',
    custom_prompt text default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    conversation_history jsonb not null default '[]'::jsonb,
    screen_analysis_history jsonb not null default '[]'::jsonb
);

-- Enable Row Level Security
alter table public.sessions enable row level security;

-- Policies for authenticated users to manage their own sessions
drop policy if exists "Users can view own sessions" on public.sessions;
create policy "Users can view own sessions"
    on public.sessions for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own sessions" on public.sessions;
create policy "Users can insert own sessions"
    on public.sessions for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own sessions" on public.sessions;
create policy "Users can update own sessions"
    on public.sessions for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own sessions" on public.sessions;
create policy "Users can delete own sessions"
    on public.sessions for delete
    to authenticated
    using ((select auth.uid()) = user_id);

-- Explicit role grants
grant select, insert, update, delete on public.sessions to authenticated;
grant all on public.sessions to service_role;

-- Chronological index per user
create index if not exists idx_sessions_user_created
    on public.sessions (user_id, created_at desc);

-- Trigger to auto-update updated_at timestamp
drop trigger if exists sessions_updated_at on public.sessions;
create trigger sessions_updated_at
    before update on public.sessions
    for each row execute function public.set_subscription_updated_at();
