-- Chunk 0.2 — Core schema + RLS baseline
-- Tables: organizations, users (ERD §3.2).
-- On sign-up, a trigger creates one organization and the matching users row.
-- Row Level Security isolates every tenant table by organization_id (ERD §6.3).

-- 1. organizations -----------------------------------------------------------
-- One row per buyer company (tenant).
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- 2. users -------------------------------------------------------------------
-- Maps 1:1 to auth.users. Adds organization membership and role.
create table if not exists public.users (
  id              uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role            text not null default 'admin'
                    check (role in ('admin', 'finance_head', 'ops_lead')),
  full_name       text,
  email           text,
  created_at      timestamptz not null default now()
);

create index if not exists users_organization_id_idx
  on public.users (organization_id);

-- 3. Helper: the caller's organization_id ------------------------------------
-- SECURITY DEFINER so the lookup does NOT re-trigger RLS on public.users.
-- This is what lets tenant policies reference the users table without
-- infinite recursion. It reads only the caller's own row (id = auth.uid()).
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.users where id = auth.uid()
$$;

-- 4. New-user trigger --------------------------------------------------------
-- On sign-up: create one organization, then the matching users row as admin.
-- SECURITY DEFINER so the inserts bypass RLS on these two tables.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
begin
  insert into public.organizations (name)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'organization_name', ''), new.email))
  returning id into new_org_id;

  insert into public.users (id, organization_id, role, full_name, email)
  values (
    new.id,
    new_org_id,
    'admin',
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Row Level Security ------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.users         enable row level security;

-- organizations: a user sees only their own organization.
drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own
  on public.organizations for select
  to authenticated
  using (id = public.current_org_id());

-- users: a user sees only members of their own organization.
drop policy if exists users_select_same_org on public.users;
create policy users_select_same_org
  on public.users for select
  to authenticated
  using (organization_id = public.current_org_id());

-- users: a user may update only their own profile row.
drop policy if exists users_update_self on public.users;
create policy users_update_self
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT or DELETE policies for the authenticated role: normal users cannot
-- create or remove organizations/users directly. The trigger above owns that,
-- running as SECURITY DEFINER. Cron and provider jobs use the service role,
-- which bypasses RLS by design (ERD §6.3).

-- 6. Table privileges --------------------------------------------------------
-- PostgREST checks SQL GRANTs BEFORE RLS. Without these, even the service role
-- gets "permission denied" (42501). RLS then narrows what `authenticated` sees.
-- `anon` is granted nothing here: these tables need a logged-in user.
grant select          on public.organizations to authenticated;
grant select, update  on public.users         to authenticated;

-- service_role is server-side only (cron, admin). It bypasses RLS but still
-- needs table privileges.
grant all on public.organizations to service_role;
grant all on public.users         to service_role;

-- Allow authenticated callers to run the org-lookup helper.
grant execute on function public.current_org_id() to authenticated;
