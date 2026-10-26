alter table public.player_registration_details
  add column if not exists category text,
  alter column primary_guardian_id drop not null,
  alter column consent_version drop not null,
  alter column consents drop not null,
  alter column consented_at drop not null,
  alter column consented_by drop not null;

create or replace function public.get_parent_onboarding_details()
returns table(full_name text, date_of_birth date, nickname text, phone text, category text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found
     or v_profile.club_id is null
     or not (
       v_profile.account_status = 'approved_pending_profile'
       or (v_profile.account_status = 'active' and not v_profile.onboarding_done)
     )
     or not public.has_role('parent'::public.user_role) then
    raise exception 'This account is not eligible for parent onboarding';
  end if;

  select i.player_id into v_player_id
  from public.invitations i
  where i.id = v_profile.invite_id
    and i.club_id = v_profile.club_id
    and i.role = 'parent'::public.user_role;

  if v_player_id is null then
    raise exception 'This parent invitation is not linked to a player record';
  end if;

  return query
    select p.full_name, p.date_of_birth, p.nickname, p.phone,
      coalesce(
        (select nullif(trim(prd.category), '')
         from public.player_registration_details prd
         where prd.player_id = p.id and prd.club_id = p.club_id),
        (select string_agg(distinct coalesce(nullif(trim(t.age_category), ''), t.name), ', ')
         from public.team_members tm
         join public.teams t on t.id = tm.team_id
         where tm.player_id = p.id
           and tm.left_at is null
           and tm.status = 'active'
           and t.deleted_at is null),
        'Category to be confirmed by the club'
      )
    from public.players p
    where p.id = v_player_id
      and p.club_id = v_profile.club_id
      and p.deleted_at is null;
end;
$$;

drop policy if exists player_accounts_admin_read on public.player_accounts;
create policy player_accounts_admin_read on public.player_accounts for select
  using (
    public.can_manage_club()
    and exists (
      select 1 from public.players p
      where p.id = player_accounts.player_id
        and p.club_id = public.current_club_id()
    )
  );
grant select on public.player_accounts to authenticated;

create or replace function public.create_manual_player_record(p_details jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid := public.current_club_id();
  v_player_id uuid;
  v_full_name text := nullif(trim(p_details->>'full_name'), '');
  v_date_of_birth date;
begin
  if auth.uid() is null or not public.can_manage_club() then
    raise exception 'Only club administrators or managers can create player records';
  end if;
  if v_full_name is null
     or nullif(trim(p_details->>'identity_document'), '') is null
     or nullif(trim(p_details->>'category'), '') is null
     or nullif(trim(p_details->>'address'), '') is null
     or nullif(trim(p_details->>'primary_guardian_name'), '') is null
     or nullif(trim(p_details->>'primary_guardian_identity_document'), '') is null
     or nullif(trim(p_details->>'primary_guardian_phone'), '') is null
     or nullif(trim(p_details->>'primary_guardian_relationship'), '') is null
     or nullif(trim(p_details->>'primary_guardian_address'), '') is null then
    raise exception 'Complete all required player and primary guardian details';
  end if;
  if nullif(trim(p_details->>'primary_guardian_email'), '') is not null
     and trim(p_details->>'primary_guardian_email') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid primary guardian email address';
  end if;
  if nullif(trim(p_details->>'email'), '') is not null
     and trim(p_details->>'email') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Enter a valid player email address';
  end if;

  begin
    v_date_of_birth := (p_details->>'date_of_birth')::date;
  exception when others then
    raise exception 'Enter a valid player date of birth';
  end;
  if v_date_of_birth is null or v_date_of_birth > current_date then
    raise exception 'Player date of birth must be today or earlier';
  end if;

  if nullif(p_details->>'height_cm', '') is not null
     and ((p_details->>'height_cm')::numeric <= 0 or (p_details->>'height_cm')::numeric > 300) then
    raise exception 'Height must be between 0 and 300 cm';
  end if;
  if nullif(p_details->>'weight_kg', '') is not null
     and ((p_details->>'weight_kg')::numeric <= 0 or (p_details->>'weight_kg')::numeric > 500) then
    raise exception 'Weight must be between 0 and 500 kg';
  end if;

  insert into public.players (
    club_id, full_name, nickname, date_of_birth, phone, email, membership_status
  ) values (
    v_club_id,
    v_full_name,
    nullif(trim(p_details->>'nickname'), ''),
    v_date_of_birth,
    nullif(trim(p_details->>'phone'), ''),
    lower(nullif(trim(p_details->>'email'), '')),
    'pending'
  )
  returning id into v_player_id;

  insert into public.player_registration_details (
    player_id, club_id, category, identity_document, address, medical_conditions,
    height_cm, weight_kg, primary_guardian_name, primary_guardian_identity_document,
    primary_guardian_phone, primary_guardian_email, primary_guardian_address,
    primary_guardian_relationship, secondary_guardian_name,
    secondary_guardian_relationship, secondary_guardian_phone,
    consent_version, consents, consented_at, consented_by
  ) values (
    v_player_id, v_club_id, trim(p_details->>'category'),
    trim(p_details->>'identity_document'), trim(p_details->>'address'),
    nullif(trim(p_details->>'medical_conditions'), ''),
    nullif(p_details->>'height_cm', '')::numeric,
    nullif(p_details->>'weight_kg', '')::numeric,
    trim(p_details->>'primary_guardian_name'),
    trim(p_details->>'primary_guardian_identity_document'),
    trim(p_details->>'primary_guardian_phone'),
    lower(nullif(trim(p_details->>'primary_guardian_email'), '')),
    trim(p_details->>'primary_guardian_address'),
    trim(p_details->>'primary_guardian_relationship'),
    nullif(trim(p_details->>'secondary_guardian_name'), ''),
    nullif(trim(p_details->>'secondary_guardian_relationship'), ''),
    nullif(trim(p_details->>'secondary_guardian_phone'), ''),
    null, null, null, null
  );

  return v_player_id;
end;
$$;

revoke all on function public.create_manual_player_record(jsonb) from public;
grant execute on function public.create_manual_player_record(jsonb) to authenticated;

create or replace function public.validate_parent_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'parent'::public.user_role then
    if new.player_id is null or nullif(trim(new.email), '') is null then
      raise exception 'Parent invitations require a player record and a parent email';
    end if;
    if not exists (
      select 1 from public.players p
      where p.id = new.player_id
        and p.club_id = new.club_id
        and p.deleted_at is null
    ) then
      raise exception 'The selected player record was not found in this club';
    end if;
  elsif new.player_id is not null then
    raise exception 'Only parent invitations can be linked to a player';
  end if;
  return new;
end;
$$;

create or replace function public.redeem_invite(
  p_token text,
  p_user_id uuid,
  p_name text,
  p_email text,
  p_phone text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_auth_email text;
begin
  select * into v_inv
  from public.invitations
  where token = p_token
    and status = 'active'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Invalid or expired invite';
  end if;

  if v_inv.role = 'parent'::public.user_role
     and (v_inv.player_id is null or nullif(trim(v_inv.email), '') is null
       or not exists (
         select 1 from public.players p
         where p.id = v_inv.player_id
           and p.club_id = v_inv.club_id
           and p.deleted_at is null
       )) then
    raise exception 'This parent invitation is not linked to an active player record';
  end if;

  select email into v_auth_email from auth.users where id = p_user_id;
  if v_auth_email is null or lower(trim(v_auth_email)) <> lower(trim(p_email)) then
    raise exception 'The account email does not match';
  end if;

  if v_inv.email is not null
     and lower(trim(v_inv.email)) <> lower(trim(p_email)) then
    raise exception 'This invitation was issued to a different email address';
  end if;

  insert into public.profiles (id, club_id, full_name, email, phone, invite_id, account_status)
  values (p_user_id, v_inv.club_id, p_name, p_email, p_phone,
          v_inv.id, 'pending_approval');

  insert into public.user_roles (user_id, club_id, role)
  values (p_user_id, v_inv.club_id, v_inv.role)
  on conflict do nothing;

  update public.invitations
  set status = 'used', used_at = now()
  where id = v_inv.id;
  return v_inv.club_id;
end;
$$;

create or replace function public.link_player_to_parent(
  p_player_id uuid,
  p_parent_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid := public.current_club_id();
  v_parent public.profiles%rowtype;
  v_player public.players%rowtype;
  v_guardian_id uuid;
  v_guardian_name text;
  v_guardian_phone text;
  v_relationship text;
begin
  if auth.uid() is null or not public.can_manage_club() then
    raise exception 'Only club administrators or managers can link a player to a parent';
  end if;

  select p.* into v_parent
  from public.profiles p
  where p.id = p_parent_user_id
    and p.club_id = v_club_id
    and p.account_status = 'active'
    and p.onboarding_done
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = p.id
        and ur.club_id = v_club_id
        and ur.role = 'parent'::public.user_role
    )
  for update of p;
  if not found then
    raise exception 'Select an active parent account in this club';
  end if;

  select p.* into v_player
  from public.players p
  where p.id = p_player_id
    and p.club_id = v_club_id
    and p.deleted_at is null
  for update;
  if not found then
    raise exception 'The player record was not found in this club';
  end if;

  select g.id into v_guardian_id
  from public.guardians g
  where g.club_id = v_club_id
    and g.user_id = v_parent.id
  order by g.created_at
  limit 1;

  select
    prd.primary_guardian_name,
    prd.primary_guardian_phone,
    prd.primary_guardian_relationship
  into v_guardian_name, v_guardian_phone, v_relationship
  from public.player_registration_details prd
  where prd.player_id = v_player.id
    and prd.club_id = v_club_id;

  if v_guardian_id is null then
    if v_guardian_name is null
       or not exists (
         select 1 from public.player_registration_details prd
         where prd.player_id = v_player.id
           and prd.club_id = v_club_id
           and lower(trim(prd.primary_guardian_email)) = lower(trim(v_parent.email))
       ) then
      raise exception 'This player has no linked guardian account. The parent email must match the primary guardian email on the player record.';
    end if;

    insert into public.guardians (club_id, user_id, full_name, phone, email)
    values (v_club_id, v_parent.id, v_guardian_name, v_guardian_phone, v_parent.email)
    returning id into v_guardian_id;
  end if;

  insert into public.player_guardians (
    player_id, guardian_id, relation, is_primary, is_billing, consent_given
  ) values (
    v_player.id, v_guardian_id, v_relationship, false, false, false
  )
  on conflict (player_id, guardian_id) do nothing;
end;
$$;

revoke all on function public.link_player_to_parent(uuid, uuid) from public;
grant execute on function public.link_player_to_parent(uuid, uuid) to authenticated;
