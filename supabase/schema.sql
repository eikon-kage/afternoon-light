-- Afternoon Light: run once in Supabase → SQL Editor.
-- Every row belongs to one user; RLS keeps each user to their own rows.

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (length(name) between 1 and 60),
  color      text not null default '#FF6B47',
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  group_id     uuid references public.groups on delete set null,
  title        text not null check (length(title) between 1 and 300),
  date         date not null,
  start_time   time,
  duration_min int  check (duration_min between 1 and 1440),
  reminder     text not null default '10' check (reminder in ('start', '10', '30', 'none')),
  repeat       text not null default 'never',
  notes        text not null default '',
  urgent       boolean not null default false,
  done         boolean not null default false,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_user_date on public.tasks (user_id, date);

-- Repeating tasks: every day of a series is its own row sharing series_id.
alter table public.tasks add column if not exists series_id   uuid;
alter table public.tasks add column if not exists repeat_days smallint check (repeat_days between 1 and 127); -- Mon = 1 … Sun = 64
alter table public.tasks add column if not exists skipped     boolean not null default false;
alter table public.tasks drop constraint if exists tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check check (repeat in ('never', 'daily', 'weekdays', 'weekly', 'custom'));
-- One row per series per day, so two devices (or the server) never create the same day twice.
do $$ begin
  alter table public.tasks add constraint tasks_series_day unique (user_id, series_id, date);
exception when duplicate_object or duplicate_table then null; end $$;

create table if not exists public.notification_settings (
  user_id        uuid primary key default auth.uid() references auth.users on delete cascade,
  before_start   boolean not null default true,
  at_start       boolean not null default true,
  nudge          boolean not null default true,
  morning        boolean not null default true,
  evening        boolean not null default true,
  weekly         boolean not null default true,
  monthly        boolean not null default true,
  quiet          boolean not null default true,
  urgent_through boolean not null default false,
  updated_at     timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.notification_settings;
create trigger settings_touch before update on public.notification_settings
  for each row execute function public.touch_updated_at();

alter table public.groups enable row level security;
alter table public.tasks enable row level security;
alter table public.notification_settings enable row level security;

drop policy if exists "own groups" on public.groups;
create policy "own groups" on public.groups for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own settings" on public.notification_settings;
create policy "own settings" on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Live sync between devices and tabs.
alter table public.tasks replica identity full;
alter table public.groups replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.tasks, public.groups, public.notification_settings;
exception when duplicate_object then null; end $$;

-- Web Push: one row per browser/device that turned on push.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  tz         text not null default 'UTC',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- What the send-reminders function already sent (so each reminder goes out once).
-- No policies: only the service role touches it.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users on delete cascade,
  key     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notification_log enable row level security;
