-- Create subscriptions table
create table if not exists public.subscriptions (
    user_id uuid primary key references auth.users (id) on delete cascade,
    stripe_customer_id text unique,
    stripe_subscription_id text unique,
    price_id text,
    status text not null default 'inactive',
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    updated_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.subscriptions enable row level security;

-- Policy: users can only view their own subscription
drop policy if exists "Users can view their own subscription" on public.subscriptions;
create policy "Users can view their own subscription"
    on public.subscriptions for select
    to authenticated
    using ((select auth.uid()) = user_id);

-- Grant select to authenticated users
grant select on public.subscriptions to authenticated;
grant select, insert, update on public.subscriptions to service_role;

-- Auto-update updated_at on any row change
create or replace function public.set_subscription_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
    before update on public.subscriptions
    for each row execute function public.set_subscription_updated_at();
