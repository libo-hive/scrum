drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all
  using (
    club_id = public.current_club_id()
    and exists (
      select 1
      from public.events e
      join public.team_members tm on tm.team_id = e.team_id
      where e.id = attendance.event_id
        and e.team_id is not null
        and tm.player_id = attendance.player_id
        and tm.left_at is null
        and tm.status = 'active'
        and public.can_manage_coach_team(e.team_id)
    )
  )
  with check (
    club_id = public.current_club_id()
    and exists (
      select 1
      from public.events e
      join public.team_members tm on tm.team_id = e.team_id
      where e.id = attendance.event_id
        and e.team_id is not null
        and tm.player_id = attendance.player_id
        and tm.left_at is null
        and tm.status = 'active'
        and public.can_manage_coach_team(e.team_id)
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
        and (
          match_events.player_id is null
          or exists (
            select 1 from public.team_members tm
            where tm.team_id = e.team_id
              and tm.player_id = match_events.player_id
              and tm.left_at is null
              and tm.status = 'active'
          )
        )
    )
  )
  with check (
    club_id = public.current_club_id()
    and exists (
      select 1 from public.events e
      where e.id = match_events.event_id
        and e.team_id is not null
        and public.can_manage_coach_team(e.team_id)
        and (
          match_events.player_id is null
          or exists (
            select 1 from public.team_members tm
            where tm.team_id = e.team_id
              and tm.player_id = match_events.player_id
              and tm.left_at is null
              and tm.status = 'active'
          )
        )
    )
  );
