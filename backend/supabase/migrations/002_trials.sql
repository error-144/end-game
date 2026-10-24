-- Migration: 002_trials.sql
-- Add free trial columns to public.subscriptions

alter table public.subscriptions
add column if not exists free_trials_used integer not null default 0,
add column if not exists free_trials_allowed integer not null default 5;

-- Optional: ensure any existing users have the defaults set
update public.subscriptions
set free_trials_used = coalesce(free_trials_used, 0),
    free_trials_allowed = coalesce(free_trials_allowed, 5);
