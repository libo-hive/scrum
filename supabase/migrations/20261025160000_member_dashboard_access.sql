create or replace function public.can_view_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.player_accounts pa
      where pa.player_id = p_player_id
        and pa.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.player_guardians pg
      join public.guardians g on g.id = pg.guardian_id
      where pg.player_id = p_player_id
        and g.user_id = auth.uid()
        and g.club_id = public.current_club_id()
    )
  )
$$;

revoke all on function public.can_view_player(uuid) from public;
grant execute on function public.can_view_player(uuid) to authenticated;

drop policy if exists players_self_read on public.players;
drop policy if exists players_parent_read on public.players;
create policy players_member_read on public.players for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and deleted_at is null
    and public.can_view_player(id)
  );

drop policy if exists team_members_coach_read on public.team_members;
create policy team_members_linked_read on public.team_members for select
  using (
    public.is_active()
    and exists (
      select 1
      from public.teams t
      where t.id = team_members.team_id
        and t.club_id = public.current_club_id()
        and t.deleted_at is null
        and (
          public.can_manage_coach_team(team_members.team_id)
          or public.can_view_player(team_members.player_id)
        )
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
      or public.can_view_player(player_id)
    )
  );

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and (
      public.has_any_role(array['admin','manager','finance']::public.user_role[])
      or (player_id is not null and public.can_view_player(player_id))
    )
  );

drop policy if exists fitness_read on public.fitness_tests;
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
      or public.can_view_player(player_id)
    )
  );

drop policy if exists match_scores_read on public.match_scores;
create policy match_scores_read on public.match_scores for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and exists (
      select 1
      from public.events e
      where e.id = match_scores.event_id
        and e.team_id is not null
        and exists (
          select 1
          from public.teams t
          where t.id = e.team_id
            and t.club_id = match_scores.club_id
            and t.deleted_at is null
        )
        and (
          public.can_manage_coach_team(e.team_id)
          or exists (
            select 1
            from public.team_members tm
            where tm.team_id = e.team_id
              and tm.left_at is null
              and public.can_view_player(tm.player_id)
          )
        )
    )
  );
