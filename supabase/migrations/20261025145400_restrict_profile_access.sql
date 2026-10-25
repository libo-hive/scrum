drop policy if exists profiles_admin_read on public.profiles;

create policy profiles_admin_read on public.profiles for select
  using (current_club_id() = club_id
    and has_any_role(array['admin','manager']::user_role[]));

grant select on public.teams to authenticated;
