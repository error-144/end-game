-- Migration: 003_user_preferences.sql
-- Store and sync user preferences across devices in Supabase

create table if not exists public.user_preferences (
    user_id uuid primary key references auth.users (id) on delete cascade,
    custom_prompt text default '',
    selected_profile text not null default 'interview',
    selected_language text not null default 'en-US',
    audio_mode text not null default 'speaker_only',
    selected_screenshot_interval text not null default '5',
    selected_image_quality text not null default 'medium',
    google_search_enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.user_preferences enable row level security;

-- Policies for authenticated users to access and modify only their own preferences
drop policy if exists "Users can view own preferences" on public.user_preferences;
create policy "Users can view own preferences"
    on public.user_preferences for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own preferences" on public.user_preferences;
create policy "Users can insert own preferences"
    on public.user_preferences for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own preferences" on public.user_preferences;
create policy "Users can update own preferences"
    on public.user_preferences for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

-- Explicit role grants
grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

-- Trigger to auto-update updated_at timestamp
drop trigger if exists user_preferences_updated_at on public.user_preferences;
create trigger user_preferences_updated_at
    before update on public.user_preferences
    for each row execute function public.set_subscription_updated_at();
