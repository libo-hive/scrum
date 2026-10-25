alter table public.events
  add column if not exists opponent text,
  add column if not exists is_home boolean not null default true;

create table if not exists public.match_scores (
  event_id uuid primary key references public.events(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  club_score integer not null check (club_score >= 0),
  opponent_score integer not null check (opponent_score >= 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.match_scores enable row level security;
alter table public.team_members enable row level security;

create or replace function public.can_manage_coach_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    where t.id = p_team_id
      and t.club_id = public.current_club_id()
      and t.deleted_at is null
      and (
        public.has_any_role(array['admin','manager','head_coach']::public.user_role[])
        or t.coach_id = auth.uid()
      )
  )
$$;

revoke all on function public.can_manage_coach_team(uuid) from public;
grant execute on function public.can_manage_coach_team(uuid) to authenticated;

drop policy if exists team_members_coach_read on public.team_members;
create policy team_members_coach_read on public.team_members for select
  using (public.is_active() and public.can_manage_coach_team(team_id));

drop policy if exists players_staff_read on public.players;
create policy players_staff_read on public.players for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager','head_coach','medic','finance']::public.user_role[])
      or exists (
        select 1 from public.team_members tm
        where tm.player_id = players.id
          and tm.left_at is null
          and tm.status = 'active'
          and public.can_manage_coach_team(tm.team_id)
      )
    )
  );

drop policy if exists events_read on public.events;
create policy events_read on public.events for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and (
      not public.has_any_role(array['coach','assistant_coach']::public.user_role[])
      or public.has_role('head_coach'::public.user_role)
      or coach_id = auth.uid()
      or (team_id is not null and public.can_manage_coach_team(team_id))
    )
  );

drop policy if exists events_write on public.events;
create policy events_write on public.events for all
  using (
    club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager']::public.user_role[])
      or (team_id is not null and public.can_manage_coach_team(team_id))
    )
  )
  with check (
    club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager']::public.user_role[])
      or (team_id is not null and public.can_manage_coach_team(team_id))
    )
  );

drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager','head_coach','medic','finance']::public.user_role[])
      or (
        public.has_any_role(array['coach','assistant_coach']::public.user_role[])
        and exists (
          select 1 from public.events e
          where e.id = attendance.event_id
            and (
              e.coach_id = auth.uid()
              or (e.team_id is not null and public.can_manage_coach_team(e.team_id))
            )
        )
      )
      or exists (
        select 1 from public.player_accounts pa
        where pa.player_id = attendance.player_id and pa.user_id = auth.uid()
      )
      or exists (
        select 1 from public.player_guardians pg
        join public.guardians g on g.id = pg.guardian_id
        where pg.player_id = attendance.player_id and g.user_id = auth.uid()
      )
    )
  );

drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all
  using (
    club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = attendance.event_id
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
    )
  )
  with check (
    club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = attendance.event_id
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
    )
  );

drop policy if exists match_events_read on public.match_events;
create policy match_events_read on public.match_events for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = match_events.event_id
        and (
          not public.has_any_role(array['coach','assistant_coach']::public.user_role[])
          or public.has_role('head_coach'::public.user_role)
          or e.coach_id = auth.uid()
          or (e.team_id is not null and public.can_manage_coach_team(e.team_id))
        )
    )
  );

drop policy if exists match_events_write on public.match_events;
create policy match_events_write on public.match_events for all
  using (
    club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = match_events.event_id
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
    )
  )
  with check (
    club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = match_events.event_id
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
    )
  );

drop policy if exists fitness_read on public.fitness_tests;
drop policy if exists fitness_write on public.fitness_tests;
create policy fitness_read on public.fitness_tests for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager','head_coach','medic']::public.user_role[])
      or exists (
        select 1 from public.team_members tm
        where tm.player_id = fitness_tests.player_id
          and tm.left_at is null
          and tm.status = 'active'
          and public.can_manage_coach_team(tm.team_id)
      )
    )
  );

create policy fitness_write on public.fitness_tests for all
  using (
    club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager','head_coach','medic']::public.user_role[])
      or exists (
        select 1 from public.team_members tm
        where tm.player_id = fitness_tests.player_id
          and tm.left_at is null
          and tm.status = 'active'
          and public.can_manage_coach_team(tm.team_id)
      )
    )
  )
  with check (
    club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager','head_coach','medic']::public.user_role[])
      or exists (
        select 1 from public.team_members tm
        where tm.player_id = fitness_tests.player_id
          and tm.left_at is null
          and tm.status = 'active'
          and public.can_manage_coach_team(tm.team_id)
      )
    )
  );

create policy match_scores_read on public.match_scores for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = match_scores.event_id
        and (e.team_id is not null and public.can_manage_coach_team(e.team_id))
    )
  );

create policy match_scores_write on public.match_scores for all
  using (
    club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = match_scores.event_id
        and e.type = 'match'
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
    )
  )
  with check (
    club_id = public.current_club_id()
    and updated_by = auth.uid()
    and exists (
      select 1 from public.events e
      where e.id = match_scores.event_id
        and e.type = 'match'
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
    )
  );

grant select on public.team_members, public.players, public.fitness_tests,
  public.events, public.attendance, public.match_events, public.match_scores
  to authenticated;
grant insert, update on public.events, public.attendance, public.match_events,
  public.match_scores to authenticated;
