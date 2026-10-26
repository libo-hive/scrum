create or replace function public.add_existing_player_to_team(
  p_team_id uuid,
  p_player_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid := public.current_club_id();
begin
  if auth.uid() is null or not public.can_manage_club() then
    raise exception 'Only club administrators or managers can add players to a team';
  end if;

  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.club_id = v_club_id
      and t.deleted_at is null
  ) then
    raise exception 'Team was not found in this club';
  end if;

  if not exists (
    select 1 from public.players p
    where p.id = p_player_id
      and p.club_id = v_club_id
      and p.deleted_at is null
  ) then
    raise exception 'Player was not found in this club';
  end if;

  if exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.player_id = p_player_id
      and tm.left_at is null
  ) then
    raise exception 'This player is already on the team roster';
  end if;

  insert into public.team_members (team_id, player_id, joined_at, left_at, status)
  values (p_team_id, p_player_id, current_date, null, 'active')
  on conflict (team_id, player_id, joined_at) do update
    set left_at = null,
        status = 'active';
end;
$$;

revoke all on function public.add_existing_player_to_team(uuid, uuid) from public;
grant execute on function public.add_existing_player_to_team(uuid, uuid) to authenticated;
