-- RLS policies on profiles and user_roles call these helpers. Running their
-- lookups as the function owner prevents recursive evaluation of those policies.
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

create or replace function has_role(p_role public.user_role) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.user_roles
    where user_id = auth.uid() and role = p_role
  )
$$;

create or replace function has_any_role(p_roles public.user_role[]) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists(
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(p_roles)
  )
$$;
