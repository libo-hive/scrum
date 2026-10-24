-- ============================================================
-- Invitations + onboarding gates
-- ============================================================

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id),
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  role        user_role not null,
  team_id     uuid references teams(id),
  player_id   uuid references players(id),   -- for parent/player invites
  email       text,                          -- optional lock
  created_by  uuid not null references profiles(id),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  used_at     timestamptz,
  revoked_at  timestamptz,
  status      text not null default 'active', -- active|used|expired|revoked
  created_at  timestamptz not null default now()
);
create index on invitations (club_id, status);

alter table profiles
  add constraint profiles_invite_fk
  foreign key (invite_id) references invitations(id);

-- ---------- Redeem invite ----------
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
begin
  select * into v_inv from invitations
   where token = p_token
     and status = 'active'
     and expires_at > now()
   for update;

  if not found then
    raise exception 'Invalid or expired invite';
  end if;

  insert into profiles (id, club_id, full_name, email, phone, invite_id, account_status)
  values (p_user_id, v_inv.club_id, p_name, p_email, p_phone,
          v_inv.id, 'pending_approval');

  insert into user_roles (user_id, club_id, role)
  values (p_user_id, v_inv.club_id, v_inv.role)
  on conflict do nothing;

  update invitations set status = 'used', used_at = now() where id = v_inv.id;
  return v_inv.club_id;
end $$;