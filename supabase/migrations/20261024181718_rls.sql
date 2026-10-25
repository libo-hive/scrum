-- ============================================================
-- Row Level Security — initial pass
-- ============================================================

-- Helper functions
create or replace function current_club_id() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select club_id from public.profiles where id = auth.uid()
$$;

create or replace function is_active() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select account_status = 'active' and onboarding_done
     from public.profiles where id = auth.uid()),
    false)
$$;

create or replace function has_role(p_role user_role) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.user_roles
    where user_id = auth.uid() and role = p_role
  )
$$;

create or replace function has_any_role(p_roles user_role[]) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(p_roles)
  )
$$;

-- Enable RLS
alter table clubs            enable row level security;
alter table profiles         enable row level security;
alter table user_roles       enable row level security;
alter table invitations      enable row level security;
alter table teams            enable row level security;
alter table players          enable row level security;
alter table player_medical   enable row level security;
alter table player_accounts  enable row level security;
alter table team_members     enable row level security;
alter table guardians        enable row level security;
alter table player_guardians enable row level security;
alter table events           enable row level security;
alter table attendance       enable row level security;
alter table match_events     enable row level security;
alter table announcements    enable row level security;
alter table invoices         enable row level security;
alter table invoice_items    enable row level security;
alter table payments         enable row level security;
alter table fitness_tests    enable row level security;

-- ---------- clubs ----------
create policy clubs_read on clubs for select
  using (id = current_club_id());

-- ---------- profiles ----------
create policy profiles_self_read on profiles for select
  using (id = auth.uid());

create policy profiles_admin_read on profiles for select
  using (current_club_id() = club_id
    and has_any_role(array['admin','manager','head_coach']::user_role[]));

-- Self update: only name/phone/photo/locale/onboarding_done
create policy profiles_self_update on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and account_status = (select account_status from profiles where id = auth.uid())
    and club_id = (select club_id from profiles where id = auth.uid())
  );

create policy profiles_admin_write on profiles for all
  using (current_club_id() = club_id
    and has_any_role(array['admin','manager']::user_role[]))
  with check (current_club_id() = club_id
    and has_any_role(array['admin','manager']::user_role[]));

-- ---------- user_roles: admin only write, user can read own ----------
create policy user_roles_self_read on user_roles for select
  using (user_id = auth.uid());

create policy user_roles_admin_read on user_roles for select
  using (current_club_id() = club_id
    and has_any_role(array['admin','manager']::user_role[]));

create policy user_roles_admin_write on user_roles for all
  using (current_club_id() = club_id
    and has_any_role(array['admin']::user_role[]))
  with check (current_club_id() = club_id
    and has_any_role(array['admin']::user_role[]));

-- ---------- invitations ----------
create policy invitations_admin_all on invitations for all
  using (current_club_id() = club_id
    and has_any_role(array['admin','manager']::user_role[]))
  with check (current_club_id() = club_id
    and has_any_role(array['admin','manager']::user_role[]));

-- (public invite lookup handled via redeem_invite function, not direct SELECT)

-- ---------- pattern for the rest ----------
-- Pattern: staff read, coaches write own team, admin write all, active users read.

-- teams: all active members read; admin/manager write
create policy teams_read on teams for select
  using (is_active() and club_id = current_club_id());
create policy teams_write on teams for all
  using (has_any_role(array['admin','manager']::user_role[]))
  with check (has_any_role(array['admin','manager']::user_role[]));

-- players: staff read all; players/parents read own
create policy players_staff_read on players for select
  using (is_active()
    and club_id = current_club_id()
    and has_any_role(array['admin','manager','head_coach','coach',
                          'assistant_coach','medic','finance']::user_role[]));

create policy players_self_read on players for select
  using (is_active() and exists (
    select 1 from player_accounts pa
    where pa.player_id = players.id and pa.user_id = auth.uid()
  ));

create policy players_parent_read on players for select
  using (is_active() and exists (
    select 1 from player_guardians pg
    join guardians g on g.id = pg.guardian_id
    where pg.player_id = players.id and g.user_id = auth.uid()
  ));

create policy players_admin_write on players for all
  using (has_any_role(array['admin','manager','head_coach']::user_role[]))
  with check (has_any_role(array['admin','manager','head_coach']::user_role[]));

-- player_medical: medic + admin + head_coach + own player + own parent
create policy medical_read on player_medical for select
  using (is_active() and (
    has_any_role(array['admin','manager','head_coach','medic']::user_role[])
    or exists (select 1 from player_accounts pa
               where pa.player_id = player_medical.player_id
                 and pa.user_id = auth.uid())
    or exists (select 1 from player_guardians pg
               join guardians g on g.id = pg.guardian_id
               where pg.player_id = player_medical.player_id
                 and g.user_id = auth.uid())
  ));
create policy medical_write on player_medical for all
  using (has_any_role(array['admin','medic','head_coach']::user_role[]))
  with check (has_any_role(array['admin','medic','head_coach']::user_role[]));

-- events: all active read own club; staff write
create policy events_read on events for select
  using (is_active() and club_id = current_club_id());
create policy events_write on events for all
  using (has_any_role(array['admin','manager','head_coach',
                            'coach','assistant_coach']::user_role[]))
  with check (has_any_role(array['admin','manager','head_coach',
                                'coach','assistant_coach']::user_role[]));

-- attendance: coaches + staff write; players/parents read own
create policy attendance_read on attendance for select
  using (is_active() and club_id = current_club_id()
    and (has_any_role(array['admin','manager','head_coach','coach',
                            'assistant_coach','medic','finance']::user_role[])
      or exists (select 1 from player_accounts pa
                 where pa.player_id = attendance.player_id
                   and pa.user_id = auth.uid())
      or exists (select 1 from player_guardians pg
                 join guardians g on g.id = pg.guardian_id
                 where pg.player_id = attendance.player_id
                   and g.user_id = auth.uid())));
create policy attendance_write on attendance for all
  using (has_any_role(array['admin','manager','head_coach',
                            'coach','assistant_coach']::user_role[]))
  with check (has_any_role(array['admin','manager','head_coach',
                                'coach','assistant_coach']::user_role[]));

-- match_events: same as attendance write set + livecoach
create policy match_events_read on match_events for select
  using (is_active() and club_id = current_club_id());
create policy match_events_write on match_events for all
  using (has_any_role(array['admin','manager','head_coach',
                            'coach','assistant_coach']::user_role[]))
  with check (has_any_role(array['admin','manager','head_coach',
                                'coach','assistant_coach']::user_role[]));

-- announcements: all active read own club; admin/manager/head_coach write
create policy ann_read on announcements for select
  using (is_active() and club_id = current_club_id());
create policy ann_write on announcements for all
  using (has_any_role(array['admin','manager','head_coach']::user_role[]))
  with check (has_any_role(array['admin','manager','head_coach']::user_role[]));

-- invoices + payments: finance + admin write; player/parent read own
create policy invoices_read on invoices for select
  using (is_active() and club_id = current_club_id()
    and (has_any_role(array['admin','manager','finance']::user_role[])
      or exists (select 1 from player_accounts pa
                 where pa.player_id = invoices.player_id
                   and pa.user_id = auth.uid())
      or exists (select 1 from player_guardians pg
                 join guardians g on g.id = pg.guardian_id
                 where pg.player_id = invoices.player_id
                   and g.user_id = auth.uid())));
create policy invoices_write on invoices for all
  using (has_any_role(array['admin','manager','finance']::user_role[]))
  with check (has_any_role(array['admin','manager','finance']::user_role[]));

create policy payments_read on payments for select
  using (is_active() and club_id = current_club_id()
    and has_any_role(array['admin','manager','finance']::user_role[]));
create policy payments_write on payments for all
  using (has_any_role(array['admin','manager','finance']::user_role[]))
  with check (has_any_role(array['admin','manager','finance']::user_role[]));

-- fitness: coaches write, players/parents read own
create policy fitness_read on fitness_tests for select
  using (is_active() and club_id = current_club_id()
    and (has_any_role(array['admin','manager','head_coach','coach',
                            'assistant_coach','medic']::user_role[])
      or exists (select 1 from player_accounts pa
                 where pa.player_id = fitness_tests.player_id
                   and pa.user_id = auth.uid())
      or exists (select 1 from player_guardians pg
                 join guardians g on g.id = pg.guardian_id
                 where pg.player_id = fitness_tests.player_id
                   and g.user_id = auth.uid())));
create policy fitness_write on fitness_tests for all
  using (has_any_role(array['admin','manager','head_coach','coach',
                            'medic']::user_role[]))
  with check (has_any_role(array['admin','manager','head_coach','coach',
                                'medic']::user_role[]));