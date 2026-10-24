-- ============================================================
-- Scrum / Rugbo — Core Schema
-- Pilot club: Serdang Eagles RFC
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type user_role as enum (
  'superadmin','admin','manager','finance',
  'head_coach','coach','assistant_coach',
  'medic','kit_man','volunteer',
  'adult_player','junior_player','parent',
  'sponsor','guest'
);

create type account_status as enum (
  'pending_approval',
  'approved_pending_profile',
  'active',
  'rejected',
  'suspended'
);

create type membership_status as enum (
  'pending','active','trial','injured','suspended','expired','inactive'
);

create type event_type as enum (
  'training','match','trial','meeting','club_activity','camp','social'
);

create type attendance_status as enum (
  'present','absent','late','mc','excused','injured'
);

create type invoice_status as enum (
  'draft','sent','paid','partially_paid','overdue','void','refunded'
);

create type payment_method as enum (
  'fpx','duitnow_qr','card','cash','bank_transfer','ewallet','cheque'
);

-- ---------- updated_at helper ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================
-- Clubs
-- ============================================================
create table clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  sport_types text[] not null default array['rugby'],
  timezone    text not null default 'Asia/Kuala_Lumpur',
  currency    char(3) not null default 'MYR',
  logo_url    text,
  domain      text unique,  -- e.g. serdangeagles.my
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- Profiles (1:1 with auth.users)
-- ============================================================
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  club_id         uuid not null references clubs(id),
  full_name       text not null,
  email           text,
  phone           text,
  photo_url       text,
  locale          text not null default 'en',
  account_status  account_status not null default 'pending_approval',
  invite_id       uuid,                         -- FK added in 0002
  onboarding_done boolean not null default false,
  rejected_reason text,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on profiles (club_id);
create index on profiles (account_status);

-- Multi-role: a user can be parent + coach, etc.
create table user_roles (
  user_id uuid not null references profiles(id) on delete cascade,
  club_id uuid not null references clubs(id),
  role    user_role not null,
  primary key (user_id, club_id, role)
);
create index on user_roles (club_id, role);

-- ============================================================
-- Teams
-- ============================================================
create table teams (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references clubs(id),
  name            text not null,
  age_category    text,
  sport           text not null default 'rugby',
  coach_id        uuid references profiles(id),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on teams (club_id);

-- ============================================================
-- Players (junior + adult)
-- ============================================================
create table players (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references clubs(id),
  full_name         text not null,
  date_of_birth     date not null,
  gender            text,
  nationality       text default 'Malaysian',
  phone             text,
  email             text,
  photo_url         text,
  jersey_no         int,
  jersey_size       text,
  position          text,
  membership_status membership_status not null default 'pending',
  join_date         date,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on players (club_id);
create unique index players_jersey_uq
  on players (club_id, jersey_no)
  where jersey_no is not null and deleted_at is null;

-- Medical data (separated for tighter RLS)
create table player_medical (
  player_id       uuid primary key references players(id) on delete cascade,
  allergies       text,
  chronic         text,
  medications     text,
  blood_type      text,
  medical_note    text,
  insurance_info  text,
  updated_at      timestamptz not null default now()
);

-- Player login (only for adult_player / junior_player with 13+)
create table player_accounts (
  player_id uuid primary key references players(id) on delete cascade,
  user_id   uuid not null unique references profiles(id) on delete cascade
);

-- Player ↔ Team history
create table team_members (
  team_id    uuid not null references teams(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  joined_at  date not null default current_date,
  left_at    date,
  status     text not null default 'active',
  primary key (team_id, player_id, joined_at)
);
create index on team_members (player_id);

-- ============================================================
-- Guardians
-- ============================================================
create table guardians (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id),
  user_id    uuid references profiles(id),
  full_name  text not null,
  phone      text,
  email      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on guardians (club_id);

create table player_guardians (
  player_id    uuid not null references players(id) on delete cascade,
  guardian_id  uuid not null references guardians(id) on delete cascade,
  relation     text,
  is_primary   boolean not null default false,
  is_billing   boolean not null default false,
  consent_given boolean not null default false,
  primary key (player_id, guardian_id)
);

-- ============================================================
-- Events (training + match + others)
-- ============================================================
create table events (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id),
  type         event_type not null,
  title        text not null,
  description  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  venue        text,
  team_id      uuid references teams(id),
  coach_id     uuid references profiles(id),
  status       text not null default 'published',
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on events (club_id, starts_at desc);
create index on events (team_id, starts_at desc);

-- ============================================================
-- Attendance
-- ============================================================
create table attendance (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references clubs(id),
  event_id      uuid not null references events(id) on delete cascade,
  player_id     uuid not null references players(id),
  status        attendance_status not null,
  check_in_at   timestamptz,
  marked_by     uuid references profiles(id),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, player_id)
);
create index on attendance (player_id, created_at desc);

-- ============================================================
-- Match events (live scoring)
-- ============================================================
create table match_events (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id),
  event_id     uuid not null references events(id) on delete cascade,
  player_id    uuid references players(id),
  minute       int,
  type         text not null,        -- try / conversion / penalty / yellow / red / sub
  detail       text,
  snapshot     jsonb not null default '{}'::jsonb,
  recorded_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index on match_events (event_id, minute);

-- ============================================================
-- Announcements
-- ============================================================
create table announcements (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references clubs(id),
  title         text not null,
  body          text not null,
  target_roles  user_role[] not null default '{}',
  team_id       uuid references teams(id),
  pinned        boolean not null default false,
  published_at  timestamptz not null default now(),
  created_by    uuid references profiles(id),
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on announcements (club_id, published_at desc);

-- ============================================================
-- Finance
-- ============================================================
create table invoices (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id),
  invoice_no   text not null,
  player_id    uuid references players(id),
  guardian_id  uuid references guardians(id),
  issue_date   date not null default current_date,
  due_date     date,
  subtotal     numeric(10,2) not null default 0,
  tax          numeric(10,2) not null default 0,
  total        numeric(10,2) not null default 0,
  currency     char(3) not null default 'MYR',
  status       invoice_status not null default 'draft',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (club_id, invoice_no)
);
create index on invoices (player_id, status);

create table invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  description text not null,
  qty         numeric(10,2) not null default 1,
  unit_price  numeric(10,2) not null,
  amount      numeric(10,2) not null
);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id),
  invoice_id   uuid references invoices(id),
  amount       numeric(10,2) not null,
  method       payment_method not null,
  reference_no text,
  paid_at      timestamptz not null default now(),
  received_by  uuid references profiles(id),
  status       text not null default 'success',
  created_at   timestamptz not null default now()
);
create index on payments (invoice_id);

-- ============================================================
-- Fitness
-- ============================================================
create table fitness_tests (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id),
  player_id  uuid not null references players(id) on delete cascade,
  test_name  text not null,
  result     numeric(10,3),
  unit       text,
  tested_at  date not null,
  created_at timestamptz not null default now()
);
create index on fitness_tests (player_id, tested_at desc);

-- ============================================================
-- updated_at triggers
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'clubs','profiles','teams','players','guardians',
    'events','attendance','announcements','invoices'
  ] loop
    execute format(
      'create trigger %1$s_set_updated_at before update on %1$s
       for each row execute function set_updated_at()', t);
  end loop;
end $$;