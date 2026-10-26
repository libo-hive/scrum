-- Supabase policies filter rows, but table and column privileges are also
-- required before authenticated clients can reach those policies.
grant select on public.profiles to authenticated;
grant update (full_name, phone, photo_url, locale) on public.profiles to authenticated;
grant update (account_status, rejected_reason) on public.profiles to authenticated;

grant select on public.user_roles to authenticated;

grant select, insert, update on public.invitations to authenticated;

grant select on public.member_details to authenticated;
