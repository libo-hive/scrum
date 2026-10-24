insert into clubs (id, name, slug, sport_types, domain)
values (
  '00000000-0000-0000-0000-000000000001',
  'Serdang Eagles RC',
  'serdang-eagles',
  array['rugby'],
  'serdangeagles.my'
)
on conflict (slug) do nothing;