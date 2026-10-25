-- Migration: 004_ai_usage.sql
-- Server-side AI usage and telemetry tracking per user

create table if not exists public.ai_usage (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    session_id text,
    event_type text not null, -- 'session_start', 'session_end', 'screenshot_analysis'
    model text,
    duration_seconds integer default 0,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.ai_usage enable row level security;

-- Policy: users can view their own usage history
drop policy if exists "Users can view own usage" on public.ai_usage;
create policy "Users can view own usage"
    on public.ai_usage for select
    to authenticated
    using ((select auth.uid()) = user_id);

-- Explicit role grants
grant select on public.ai_usage to authenticated;
grant select, insert, update, delete on public.ai_usage to service_role;

-- Performance index for chronological queries per user
create index if not exists idx_ai_usage_user_created
    on public.ai_usage (user_id, created_at desc);
