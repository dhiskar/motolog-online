-- ===========================================================
-- MotoLog online — skema Supabase
-- Jalankan seluruh file ini sekali di Supabase Dashboard:
--   SQL Editor → New query → tempel → Run
-- Aman dijalankan ulang (idempotent).
-- ===========================================================

create extension if not exists pgcrypto;

-- ---------- trigger updated_at ----------
create or replace function public.motolog_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profil / pengaturan per akun ----------
create table if not exists public.profiles (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  theme             text not null default 'auto' check (theme in ('auto', 'light', 'dark')),
  oil_km            integer not null default 2500 check (oil_km between 200 and 20000),
  oil_months        integer not null default 4 check (oil_months between 1 and 36),
  active_bike       uuid,
  install_dismissed boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- motor ----------
create table if not exists public.bikes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  brand      text not null default '',
  model      text not null default '',
  year       integer,
  plate      text not null default '',
  color      text not null default '',
  odo        numeric not null default 0 check (odo >= 0),
  photo      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- ---------- catatan ----------
create table if not exists public.records (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bike_id    uuid not null,
  type       text not null check (type in ('oil', 'repair', 'fuel', 'other')),
  date       date not null default current_date,
  odo        numeric check (odo is null or odo >= 0),
  amount     numeric not null default 0 check (amount >= 0),
  note       text not null default '',
  title      text not null default '',
  oil_brand  text not null default '',
  oil_type   text not null default '',
  next_odo   numeric check (next_odo is null or next_odo >= 0),
  next_date  date,
  liters     numeric check (liters is null or liters >= 0),
  price      numeric check (price is null or price >= 0),
  is_full    boolean not null default true,
  shop       text not null default '',
  category   text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bike_id, user_id) references public.bikes (id, user_id) on delete cascade
);

-- ---------- pengingat ----------
create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bike_id    uuid not null,
  title      text not null,
  due_date   date,
  due_odo    numeric check (due_odo is null or due_odo >= 0),
  note       text not null default '',
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bike_id, user_id) references public.bikes (id, user_id) on delete cascade
);

-- ---------- indeks ----------
create index if not exists bikes_user_created_idx    on public.bikes (user_id, created_at);
create index if not exists records_user_bike_idx     on public.records (user_id, bike_id, date desc);
create index if not exists reminders_user_bike_idx   on public.reminders (user_id, bike_id);

-- ---------- trigger updated_at ----------
drop trigger if exists bikes_touch_updated_at on public.bikes;
create trigger bikes_touch_updated_at
  before update on public.bikes
  for each row execute function public.motolog_touch_updated_at();

drop trigger if exists records_touch_updated_at on public.records;
create trigger records_touch_updated_at
  before update on public.records
  for each row execute function public.motolog_touch_updated_at();

drop trigger if exists reminders_touch_updated_at on public.reminders;
create trigger reminders_touch_updated_at
  before update on public.reminders
  for each row execute function public.motolog_touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.motolog_touch_updated_at();

-- ---------- profil otomatis untuk user baru ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profil untuk akun yang sudah terlanjur dibuat.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ---------- izin tabel ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles  to authenticated;
grant select, insert, update, delete on public.bikes     to authenticated;
grant select, insert, update, delete on public.records   to authenticated;
grant select, insert, update, delete on public.reminders to authenticated;

-- ---------- Row Level Security ----------
-- Setiap baris hanya bisa dibaca/ditulis oleh pemiliknya (auth.uid() = user_id).
alter table public.profiles  enable row level security;
alter table public.bikes     enable row level security;
alter table public.records   enable row level security;
alter table public.reminders enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists bikes_own on public.bikes;
create policy bikes_own on public.bikes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists records_own on public.records;
create policy records_own on public.records
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists reminders_own on public.reminders;
create policy reminders_own on public.reminders
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
