-- Member profile details collected after an administrator approves an invite.
create table member_details (
  user_id     uuid primary key references profiles(id) on delete cascade,
  club_id     uuid not null references clubs(id),
  role        user_role not null,
  details     jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table member_details enable row level security;

create policy member_details_self_read on member_details for select
  using (user_id = auth.uid());

create policy member_details_admin_read on member_details for select
  using (club_id = current_club_id()
    and has_any_role(array['admin','manager']::user_role[]));

create or replace function complete_member_onboarding(p_details jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_role user_role;
  v_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to complete onboarding';
  end if;

  select * into v_profile
  from profiles
  where id = auth.uid()
  for update;

  if not found or (
    v_profile.account_status <> 'approved_pending_profile'
    and not (v_profile.account_status = 'active' and not v_profile.onboarding_done)
  ) then
    raise exception 'Your membership is not approved for onboarding';
  end if;

  if jsonb_typeof(p_details) <> 'object' then
    raise exception 'Onboarding details must be an object';
  end if;

  select role into v_role
  from user_roles
  where user_id = auth.uid() and club_id = v_profile.club_id
  limit 1;

  if v_role is null then
    raise exception 'No membership role was found';
  end if;

  if v_role in ('adult_player', 'junior_player')
     and (nullif(trim(p_details->>'date_of_birth'), '') is null
       or nullif(trim(p_details->>'gender'), '') is null
       or nullif(trim(p_details->>'preferred_position'), '') is null
       or nullif(trim(p_details->>'emergency_contact_name'), '') is null
       or nullif(trim(p_details->>'emergency_contact_phone'), '') is null) then
    raise exception 'Complete the required player details';
  elsif v_role = 'parent'
     and (nullif(trim(p_details->>'relationship_to_player'), '') is null
       or nullif(trim(p_details->>'player_full_name'), '') is null
       or nullif(trim(p_details->>'player_date_of_birth'), '') is null) then
    raise exception 'Complete the required parent details';
  elsif v_role in ('head_coach', 'coach', 'assistant_coach')
     and (nullif(trim(p_details->>'coaching_category'), '') is null
       or nullif(trim(p_details->>'preferred_team'), '') is null) then
    raise exception 'Complete the required coaching details';
  elsif v_role not in ('adult_player', 'junior_player', 'parent',
                       'head_coach', 'coach', 'assistant_coach')
     and (nullif(trim(p_details->>'department'), '') is null
       or nullif(trim(p_details->>'emergency_contact_name'), '') is null
       or nullif(trim(p_details->>'emergency_contact_phone'), '') is null) then
    raise exception 'Complete the required staff details';
  end if;

  insert into member_details (user_id, club_id, role, details)
  values (auth.uid(), v_profile.club_id, v_role, p_details)
  on conflict (user_id) do update
    set role = excluded.role,
        details = excluded.details,
        completed_at = now(),
        updated_at = now();

  if v_role in ('adult_player', 'junior_player') then
    insert into players (
      club_id, full_name, date_of_birth, gender, phone, email, position
    ) values (
      v_profile.club_id,
      v_profile.full_name,
      (p_details->>'date_of_birth')::date,
      p_details->>'gender',
      v_profile.phone,
      v_profile.email,
      p_details->>'preferred_position'
    ) returning id into v_player_id;

    insert into player_accounts (player_id, user_id)
    values (v_player_id, auth.uid());
  elsif v_role = 'parent' then
    insert into guardians (club_id, user_id, full_name, phone, email)
    values (v_profile.club_id, auth.uid(), v_profile.full_name, v_profile.phone, v_profile.email);
  end if;

  update profiles
  set account_status = 'active',
      onboarding_done = true
  where id = auth.uid();
end;
$$;

revoke all on function complete_member_onboarding(jsonb) from public;
grant execute on function complete_member_onboarding(jsonb) to authenticated;

create or replace function get_invite_details(p_token text)
returns table(role user_role, email text, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select i.role, i.email, i.expires_at
  from invitations i
  where i.token = p_token
    and i.status = 'active'
    and i.expires_at > now()
  limit 1
$$;

revoke all on function get_invite_details(text) from public;
grant execute on function get_invite_details(text) to anon, authenticated;

-- Enforce invitation email locks at redemption rather than relying on the UI.
create or replace function redeem_invite(
  p_token   text,
  p_user_id uuid,
  p_name    text,
  p_email   text,
  p_phone   text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv invitations;
  v_auth_email text;
begin
  select * into v_inv from invitations
   where token = p_token
     and status = 'active'
     and expires_at > now()
   for update;

  if not found then
    raise exception 'Invalid or expired invite';
  end if;

  select email into v_auth_email from auth.users where id = p_user_id;
  if v_auth_email is null or lower(trim(v_auth_email)) <> lower(trim(p_email)) then
    raise exception 'The account email does not match';
  end if;

  if v_inv.email is not null
     and lower(trim(v_inv.email)) <> lower(trim(p_email)) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  insert into profiles (id, club_id, full_name, email, phone, invite_id, account_status)
  values (p_user_id, v_inv.club_id, p_name, p_email, p_phone,
          v_inv.id, 'pending_approval');

  insert into user_roles (user_id, club_id, role)
  values (p_user_id, v_inv.club_id, v_inv.role)
  on conflict do nothing;

  update invitations set status = 'used', used_at = now() where id = v_inv.id;
  return v_inv.club_id;
end;
$$;
