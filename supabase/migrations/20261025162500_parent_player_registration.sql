alter table public.players
  add column if not exists nickname text;

create table if not exists public.player_registration_details (
  player_id uuid primary key references public.players(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  identity_document text not null,
  address text not null,
  medical_conditions text,
  height_cm numeric(5,1),
  weight_kg numeric(5,1),
  primary_guardian_id uuid not null references public.guardians(id),
  primary_guardian_name text not null,
  primary_guardian_identity_document text not null,
  primary_guardian_phone text not null,
  primary_guardian_email text,
  primary_guardian_address text not null,
  primary_guardian_relationship text not null,
  secondary_guardian_id uuid references public.guardians(id),
  secondary_guardian_name text,
  secondary_guardian_relationship text,
  secondary_guardian_phone text,
  consent_version text not null,
  consents jsonb not null,
  consented_at timestamptz not null default now(),
  consented_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.player_registration_details enable row level security;
create policy player_registration_details_admin_read
  on public.player_registration_details for select
  using (club_id = public.current_club_id() and public.can_manage_club());
create policy player_registration_details_guardian_read
  on public.player_registration_details for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and public.can_view_player(player_id)
  );
grant select on public.player_registration_details to authenticated;

create or replace function public.validate_parent_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'parent'::public.user_role then
    if new.player_id is null or nullif(trim(new.email), '') is null then
      raise exception 'Parent invitations require a roster player and a parent email';
    end if;
    if not exists (
      select 1 from public.players p
      where p.id = new.player_id
        and p.club_id = new.club_id
        and p.deleted_at is null
        and exists (
          select 1
          from public.team_members tm
          join public.teams t on t.id = tm.team_id
          where tm.player_id = p.id
            and tm.left_at is null
            and tm.status = 'active'
            and t.club_id = new.club_id
            and t.deleted_at is null
        )
    ) then
      raise exception 'The selected player must be active on a club roster';
    end if;
  elsif new.player_id is not null then
    raise exception 'Only parent invitations can be linked to a player';
  end if;
  return new;
end;
$$;

create trigger invitations_validate_parent_player
  before insert or update of role, club_id, player_id, email
  on public.invitations
  for each row execute function public.validate_parent_invitation();

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
    raise exception 'This parent invitation is not linked to a roster player';
  end if;

  return query
    select p.full_name, p.date_of_birth, p.nickname, p.phone,
      coalesce((
        select string_agg(distinct coalesce(nullif(trim(t.age_category), ''), t.name), ', ')
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where tm.player_id = p.id
          and tm.left_at is null
          and tm.status = 'active'
          and t.deleted_at is null
      ), 'Category to be confirmed by the club')
    from public.players p
    where p.id = v_player_id
      and p.club_id = v_profile.club_id
      and p.deleted_at is null;
end;
$$;

revoke all on function public.get_parent_onboarding_details() from public;
grant execute on function public.get_parent_onboarding_details() to authenticated;

drop function public.get_invite_details(text);
create function public.get_invite_details(p_token text)
returns table(role public.user_role, email text, expires_at timestamptz, player_name text)
language sql
security definer
set search_path = ''
as $$
  select i.role, i.email, i.expires_at, p.full_name
  from public.invitations i
  left join public.players p on p.id = i.player_id and p.club_id = i.club_id
  where i.token = p_token
    and i.status = 'active'
    and i.expires_at > now()
  limit 1
$$;
revoke all on function public.get_invite_details(text) from public;
grant execute on function public.get_invite_details(text) to anon, authenticated;

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
    raise exception 'This parent invitation is not linked to an active roster player';
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

create or replace function public.complete_member_onboarding(p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_role public.user_role;
  v_player_id uuid;
  v_inv public.invitations%rowtype;
  v_player public.players%rowtype;
  v_guardian_id uuid;
  v_guardian2_id uuid;
  v_consents jsonb;
  v_guardian2_name text;
  v_guardian2_relationship text;
  v_guardian2_phone text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to complete onboarding';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid()
  for update;

  if not found or (
    v_profile.account_status <> 'approved_pending_profile'
    and not (v_profile.account_status = 'active' and not v_profile.onboarding_done)
  ) then
    raise exception 'Your membership is not approved for onboarding';
  end if;

  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Onboarding details must be an object';
  end if;

  select role into v_role
  from public.user_roles
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
  elsif v_role = 'parent' then
    if nullif(trim(p_details->>'player_full_name'), '') is null
       or nullif(trim(p_details->>'player_date_of_birth'), '') is null
       or nullif(trim(p_details->>'player_identity_document'), '') is null
       or nullif(trim(p_details->>'player_address'), '') is null
       or nullif(trim(p_details->>'guardian_name'), '') is null
       or nullif(trim(p_details->>'guardian_identity_document'), '') is null
       or nullif(trim(p_details->>'guardian_phone'), '') is null
       or nullif(trim(p_details->>'relationship_to_player'), '') is null
       or nullif(trim(p_details->>'guardian_address'), '') is null then
      raise exception 'Complete all required player and primary guardian details';
    end if;
    if (p_details->>'player_date_of_birth')::date > current_date then
      raise exception 'Player date of birth cannot be in the future';
    end if;
    if coalesce(p_details->'consents'->>'rugby_risk', 'false') <> 'true'
       or coalesce(p_details->'consents'->>'volunteer_program', 'false') <> 'true'
       or coalesce(p_details->'consents'->>'guardian_presence', 'false') <> 'true'
       or coalesce(p_details->'consents'->>'information_and_rules', 'false') <> 'true'
       or coalesce(p_details->'consents'->>'fees', 'false') <> 'true'
       or coalesce(p_details->'consents'->>'player_ethics', 'false') <> 'true'
       or coalesce(p_details->'consents'->>'parent_ethics', 'false') <> 'true' then
      raise exception 'Please accept each required participation and club policy consent';
    end if;
    if (nullif(trim(p_details->>'guardian2_name'), '') is not null
        or nullif(trim(p_details->>'guardian2_relationship'), '') is not null
        or nullif(trim(p_details->>'guardian2_phone'), '') is not null)
       and (nullif(trim(p_details->>'guardian2_name'), '') is null
         or nullif(trim(p_details->>'guardian2_relationship'), '') is null
         or nullif(trim(p_details->>'guardian2_phone'), '') is null) then
      raise exception 'Complete the name, relationship and phone for guardian 2, or leave all three blank';
    end if;
    if nullif(trim(p_details->>'height_cm'), '') is not null
       and (p_details->>'height_cm' !~ '^[0-9]+([.][0-9]+)?$'
         or (p_details->>'height_cm')::numeric < 40
         or (p_details->>'height_cm')::numeric > 250) then
      raise exception 'Enter a valid height in centimetres';
    end if;
    if nullif(trim(p_details->>'weight_kg'), '') is not null
       and (p_details->>'weight_kg' !~ '^[0-9]+([.][0-9]+)?$'
         or (p_details->>'weight_kg')::numeric < 5
         or (p_details->>'weight_kg')::numeric > 250) then
      raise exception 'Enter a valid weight in kilograms';
    end if;
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

  insert into public.member_details (user_id, club_id, role, details)
  values (auth.uid(), v_profile.club_id, v_role, p_details)
  on conflict (user_id) do update
    set role = excluded.role,
        details = excluded.details,
        completed_at = now(),
        updated_at = now();

  if v_role in ('adult_player', 'junior_player') then
    insert into public.players (
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

    insert into public.player_accounts (player_id, user_id)
    values (v_player_id, auth.uid());
  elsif v_role = 'parent' then
    select * into v_inv
    from public.invitations
    where id = v_profile.invite_id
      and club_id = v_profile.club_id
      and role = 'parent'::public.user_role;
    if not found or v_inv.player_id is null then
      raise exception 'The parent invitation is not linked to a player';
    end if;

    select * into v_player
    from public.players
    where id = v_inv.player_id
      and club_id = v_profile.club_id
      and deleted_at is null
    for update;
    if not found then
      raise exception 'The linked roster player could not be found';
    end if;

    update public.players
    set full_name = trim(p_details->>'player_full_name'),
        nickname = nullif(trim(p_details->>'player_nickname'), ''),
        phone = nullif(trim(p_details->>'player_phone'), ''),
        date_of_birth = (p_details->>'player_date_of_birth')::date
    where id = v_player.id;

    insert into public.guardians (
      club_id, user_id, full_name, phone, email
    ) values (
      v_profile.club_id, auth.uid(), trim(p_details->>'guardian_name'),
      trim(p_details->>'guardian_phone'), v_profile.email
    ) returning id into v_guardian_id;

    insert into public.player_guardians (
      player_id, guardian_id, relation, is_primary, is_billing, consent_given
    ) values (
      v_player.id, v_guardian_id, trim(p_details->>'relationship_to_player'), true, true, true
    );

    v_guardian2_name := nullif(trim(p_details->>'guardian2_name'), '');
    v_guardian2_relationship := nullif(trim(p_details->>'guardian2_relationship'), '');
    v_guardian2_phone := nullif(trim(p_details->>'guardian2_phone'), '');
    if v_guardian2_name is not null then
      insert into public.guardians (club_id, full_name, phone)
      values (v_profile.club_id, v_guardian2_name, v_guardian2_phone)
      returning id into v_guardian2_id;
      insert into public.player_guardians (
        player_id, guardian_id, relation, is_primary, is_billing, consent_given
      ) values (
        v_player.id, v_guardian2_id, v_guardian2_relationship, false, false, false
      );
    end if;

    v_consents := jsonb_build_object(
      'rugby_risk', (p_details->'consents'->>'rugby_risk')::boolean,
      'volunteer_program', (p_details->'consents'->>'volunteer_program')::boolean,
      'guardian_presence', (p_details->'consents'->>'guardian_presence')::boolean,
      'information_and_rules', (p_details->'consents'->>'information_and_rules')::boolean,
      'fees', (p_details->'consents'->>'fees')::boolean,
      'player_ethics', (p_details->'consents'->>'player_ethics')::boolean,
      'parent_ethics', (p_details->'consents'->>'parent_ethics')::boolean,
      'media', coalesce((p_details->'consents'->>'media')::boolean, false),
      'marketing_updates', coalesce((p_details->'consents'->>'marketing_updates')::boolean, false)
    );

    insert into public.player_registration_details (
      player_id, club_id, identity_document, address, medical_conditions, height_cm, weight_kg,
      primary_guardian_id,
      primary_guardian_name, primary_guardian_identity_document, primary_guardian_phone,
      primary_guardian_email, primary_guardian_address, primary_guardian_relationship,
      secondary_guardian_id,
      secondary_guardian_name, secondary_guardian_relationship, secondary_guardian_phone,
      consent_version, consents, consented_by
    ) values (
      v_player.id, v_profile.club_id, trim(p_details->>'player_identity_document'),
      trim(p_details->>'player_address'), nullif(trim(p_details->>'medical_conditions'), ''),
      nullif(trim(p_details->>'height_cm'), '')::numeric,
      nullif(trim(p_details->>'weight_kg'), '')::numeric,
      v_guardian_id,
      trim(p_details->>'guardian_name'), trim(p_details->>'guardian_identity_document'),
      trim(p_details->>'guardian_phone'), v_profile.email, trim(p_details->>'guardian_address'),
      trim(p_details->>'relationship_to_player'),
      v_guardian2_id, v_guardian2_name, v_guardian2_relationship, v_guardian2_phone,
      'draft-2026-10-25', v_consents, auth.uid()
    )
    on conflict (player_id) do update
      set identity_document = excluded.identity_document,
          address = excluded.address,
          medical_conditions = excluded.medical_conditions,
          height_cm = excluded.height_cm,
          weight_kg = excluded.weight_kg,
          primary_guardian_id = excluded.primary_guardian_id,
          primary_guardian_name = excluded.primary_guardian_name,
          primary_guardian_identity_document = excluded.primary_guardian_identity_document,
          primary_guardian_phone = excluded.primary_guardian_phone,
          primary_guardian_email = excluded.primary_guardian_email,
          primary_guardian_address = excluded.primary_guardian_address,
          primary_guardian_relationship = excluded.primary_guardian_relationship,
          secondary_guardian_id = excluded.secondary_guardian_id,
          secondary_guardian_name = excluded.secondary_guardian_name,
          secondary_guardian_relationship = excluded.secondary_guardian_relationship,
          secondary_guardian_phone = excluded.secondary_guardian_phone,
          consent_version = excluded.consent_version,
          consents = excluded.consents,
          consented_at = now(),
          consented_by = excluded.consented_by,
          updated_at = now();
  end if;

  update public.profiles
  set account_status = 'active',
      onboarding_done = true
  where id = auth.uid();
end;
$$;

revoke all on function public.complete_member_onboarding(jsonb) from public;
grant execute on function public.complete_member_onboarding(jsonb) to authenticated;
