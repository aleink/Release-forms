-- Release Forms independent backend
-- Apply in a new Supabase project.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('staff', 'manager', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'service_type') then
    create type public.service_type as enum ('tattoo', 'piercing');
  end if;
  if not exists (select 1 from pg_type where typname = 'release_form_status') then
    create type public.release_form_status as enum ('draft', 'submitted', 'needs_review', 'cleared', 'archived');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role public.app_role not null default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  state text not null,
  jurisdiction text not null,
  timezone text not null default 'America/Los_Angeles',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_locations (
  user_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  can_manage boolean not null default false,
  primary key (user_id, location_id)
);

create table if not exists public.requirement_versions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  version_label text not null,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  adult_age int not null default 18,
  retention_years int not null default 2,
  standard_fields jsonb not null default '[]'::jsonb,
  tattoo_fields jsonb not null default '[]'::jsonb,
  piercing_fields jsonb not null default '[]'::jsonb,
  minor_rules jsonb not null default '[]'::jsonb,
  release_copy jsonb not null default '[]'::jsonb,
  source_notes jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists requirement_versions_one_active
  on public.requirement_versions(location_id)
  where retired_at is null;

create table if not exists public.release_form_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  location_id uuid not null references public.locations(id) on delete cascade,
  requirement_version_id uuid references public.requirement_versions(id) on delete set null,
  client_hint jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.release_forms (
  id uuid primary key default gen_random_uuid(),
  public_number text not null unique default ('RF-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  location_id uuid not null references public.locations(id) on delete restrict,
  requirement_version_id uuid references public.requirement_versions(id) on delete restrict,
  link_id uuid references public.release_form_links(id) on delete set null,
  service_type public.service_type not null,
  status public.release_form_status not null default 'submitted',
  client jsonb not null default '{}'::jsonb,
  age_at_submission int,
  guardian jsonb,
  procedure jsonb not null default '{}'::jsonb,
  health jsonb not null default '{}'::jsonb,
  signatures jsonb not null default '{}'::jsonb,
  final_pdf_path text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.release_form_documents (
  id uuid primary key default gen_random_uuid(),
  release_form_id uuid not null references public.release_forms(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  document_type text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin'::public.app_role, false)
$$;

create or replace function public.current_user_location_ids()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(location_id), '{}'::uuid[])
  from public.user_locations
  where user_id = auth.uid()
$$;

create or replace function public.can_access_location(p_location_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.user_locations
      where user_id = auth.uid()
        and location_id = p_location_id
    )
$$;

create or replace function public.can_manage_location(p_location_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1 from public.user_locations
      where user_id = auth.uid()
        and location_id = p_location_id
        and can_manage = true
    )
$$;

create or replace function public.hash_release_token(p_token text)
returns text
language sql immutable
as $$
  select encode(digest(p_token, 'sha256'), 'hex')
$$;

create or replace function public.submit_public_release_form(p_token text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_link public.release_form_links%rowtype;
  v_form_id uuid;
begin
  select * into v_link
  from public.release_form_links
  where token_hash = public.hash_release_token(p_token)
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_link.id is null then
    raise exception 'Invalid or expired release form link';
  end if;

  insert into public.release_forms (
    location_id,
    requirement_version_id,
    link_id,
    service_type,
    client,
    age_at_submission,
    guardian,
    procedure,
    health,
    signatures
  ) values (
    v_link.location_id,
    coalesce(v_link.requirement_version_id, (p_payload->>'requirement_version_id')::uuid),
    v_link.id,
    coalesce((p_payload->>'service_type')::public.service_type, 'tattoo'::public.service_type),
    coalesce(p_payload->'client', '{}'::jsonb),
    nullif(p_payload#>>'{client,age_at_submission}', '')::int,
    p_payload->'minor',
    coalesce(p_payload->'procedure', '{}'::jsonb),
    coalesce(p_payload->'health', '{}'::jsonb),
    coalesce(p_payload->'signatures', '{}'::jsonb)
  )
  returning id into v_form_id;

  update public.release_form_links
  set used_at = now()
  where id = v_link.id and used_at is null;

  return jsonb_build_object('id', v_form_id);
end;
$$;

revoke all on function public.submit_public_release_form(text, jsonb) from public;
grant execute on function public.submit_public_release_form(text, jsonb) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.user_locations enable row level security;
alter table public.requirement_versions enable row level security;
alter table public.release_form_links enable row level security;
alter table public.release_forms enable row level security;
alter table public.release_form_documents enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists locations_scoped_select on public.locations;
create policy locations_scoped_select on public.locations
  for select to authenticated
  using (public.can_access_location(id));

drop policy if exists locations_admin_write on public.locations;
create policy locations_admin_write on public.locations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_locations_scoped_select on public.user_locations;
create policy user_locations_scoped_select on public.user_locations
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists user_locations_admin_write on public.user_locations;
create policy user_locations_admin_write on public.user_locations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists requirements_scoped_select on public.requirement_versions;
create policy requirements_scoped_select on public.requirement_versions
  for select to authenticated
  using (public.can_access_location(location_id));

drop policy if exists requirements_manager_write on public.requirement_versions;
create policy requirements_manager_write on public.requirement_versions
  for all to authenticated
  using (public.can_manage_location(location_id))
  with check (public.can_manage_location(location_id));

drop policy if exists links_manager_all on public.release_form_links;
create policy links_manager_all on public.release_form_links
  for all to authenticated
  using (public.can_manage_location(location_id))
  with check (public.can_manage_location(location_id));

drop policy if exists release_forms_scoped_select on public.release_forms;
create policy release_forms_scoped_select on public.release_forms
  for select to authenticated
  using (public.can_access_location(location_id));

drop policy if exists release_forms_manager_update on public.release_forms;
create policy release_forms_manager_update on public.release_forms
  for update to authenticated
  using (public.can_manage_location(location_id))
  with check (public.can_manage_location(location_id));

drop policy if exists documents_scoped_select on public.release_form_documents;
create policy documents_scoped_select on public.release_form_documents
  for select to authenticated
  using (public.can_access_location(location_id));

drop policy if exists audit_scoped_select on public.audit_events;
create policy audit_scoped_select on public.audit_events
  for select to authenticated
  using (location_id is null or public.can_access_location(location_id));

insert into storage.buckets (id, name, public)
values ('release-form-documents', 'release-form-documents', false)
on conflict (id) do update set public = false;

drop policy if exists release_doc_read on storage.objects;
create policy release_doc_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'release-form-documents'
    and exists (
      select 1 from public.release_form_documents d
      where d.storage_path = name
        and public.can_access_location(d.location_id)
    )
  );

commit;
