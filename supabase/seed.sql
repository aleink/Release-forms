insert into public.locations (slug, name, state, jurisdiction, timezone)
values
  ('miami', 'Miami', 'FL', 'Florida Department of Health / Miami-Dade', 'America/New_York'),
  ('houston', 'Houston', 'TX', 'Texas Department of State Health Services', 'America/Chicago'),
  ('las-vegas', 'Las Vegas', 'NV', 'Southern Nevada Health District', 'America/Los_Angeles'),
  ('new-jersey', 'New Jersey', 'NJ', 'New Jersey Department of Health', 'America/New_York')
on conflict (slug) do update set
  name = excluded.name,
  state = excluded.state,
  jurisdiction = excluded.jurisdiction,
  timezone = excluded.timezone;

with loc as (
  select id, slug from public.locations
)
insert into public.requirement_versions (
  location_id,
  version_label,
  adult_age,
  retention_years,
  tattoo_fields,
  piercing_fields,
  minor_rules,
  source_notes
)
select
  id,
  'seed-2026-05-13',
  18,
  case when slug = 'new-jersey' then 3 else 2 end,
  case slug
    when 'miami' then '[{"id":"race","label":"Race","type":"text","required":true,"audience":"client"},{"id":"artist_name","label":"Artist name","type":"text","required":true,"audience":"staff"},{"id":"artist_signature","label":"Artist signature","type":"signature","required":true,"audience":"staff"}]'::jsonb
    when 'houston' then '[{"id":"ink_colors","label":"Ink color(s) used","type":"text","required":true,"audience":"staff"},{"id":"ink_lot_numbers","label":"Lot number(s) for ink used","type":"text","required":true,"audience":"staff"},{"id":"body_location","label":"Location on body","type":"text","required":true,"audience":"staff"},{"id":"artist_name","label":"Artist name","type":"text","required":true,"audience":"staff"}]'::jsonb
    when 'las-vegas' then '[{"id":"ink_colors","label":"Ink color(s) used","type":"text","required":true,"audience":"staff"},{"id":"ink_lot_numbers","label":"Lot number(s) for ink used","type":"text","required":true,"audience":"staff"},{"id":"ink_expiration_dates","label":"Expiration date(s) of ink used","type":"text","required":true,"audience":"staff"},{"id":"needle_expiration_dates","label":"Expiration date(s) of needles used","type":"text","required":true,"audience":"staff"},{"id":"needle_lot_numbers","label":"Lot number(s) of needles used","type":"text","required":true,"audience":"staff"},{"id":"body_location","label":"Location on body","type":"text","required":true,"audience":"staff"},{"id":"artist_name","label":"Artist name","type":"text","required":true,"audience":"staff"},{"id":"artist_signature","label":"Artist signature","type":"signature","required":true,"audience":"staff"},{"id":"design_description","label":"Design","type":"textarea","required":true,"audience":"staff"}]'::jsonb
    else '[{"id":"body_location","label":"Location on body","type":"text","required":true,"audience":"staff"},{"id":"artist_name","label":"Artist name","type":"text","required":true,"audience":"staff"},{"id":"emergency_contact","label":"Emergency contact name and phone number","type":"text","required":true,"audience":"client"}]'::jsonb
  end,
  case slug
    when 'miami' then '[{"id":"emergency_contact_name","label":"Emergency contact name","type":"text","required":true,"audience":"client"},{"id":"emergency_contact_phone","label":"Emergency contact phone number","type":"phone","required":true,"audience":"client"},{"id":"emergency_contact_address","label":"Emergency contact address","type":"text","required":true,"audience":"client"},{"id":"physician_name","label":"Physician name","type":"text","required":true,"audience":"client"},{"id":"physician_phone","label":"Physician phone number","type":"phone","required":true,"audience":"client"},{"id":"physician_address","label":"Physician address","type":"text","required":true,"audience":"client"},{"id":"race","label":"Race","type":"text","required":true,"audience":"client"},{"id":"piercer_name","label":"Piercer name","type":"text","required":true,"audience":"staff"},{"id":"piercer_signature","label":"Piercer signature","type":"signature","required":true,"audience":"staff"},{"id":"piercing_type","label":"Piercing type","type":"text","required":true,"audience":"staff"},{"id":"jewelry_type_used","label":"Jewelry type used","type":"text","required":true,"audience":"staff"}]'::jsonb
    when 'houston' then '[{"id":"piercing_type","label":"Piercing type","type":"text","required":true,"audience":"staff"},{"id":"jewelry_type_used","label":"Jewelry type used","type":"text","required":true,"audience":"staff"},{"id":"piercer_name","label":"Piercer name","type":"text","required":true,"audience":"staff"}]'::jsonb
    when 'las-vegas' then '[{"id":"piercing_type","label":"Piercing type","type":"text","required":true,"audience":"staff"},{"id":"jewelry_type_used","label":"Jewelry type used","type":"text","required":true,"audience":"staff"},{"id":"piercer_name","label":"Piercer name","type":"text","required":true,"audience":"staff"},{"id":"piercer_signature","label":"Piercer signature","type":"signature","required":true,"audience":"staff"}]'::jsonb
    else '[{"id":"piercing_type","label":"Piercing type","type":"text","required":true,"audience":"staff"},{"id":"piercer_name","label":"Piercer name","type":"text","required":true,"audience":"staff"},{"id":"emergency_contact","label":"Emergency contact name and phone number","type":"text","required":true,"audience":"client"}]'::jsonb
  end,
  '[]'::jsonb,
  '[]'::jsonb
from loc
on conflict do nothing;
