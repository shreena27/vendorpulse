-- Chunk 1.1 — Vendor bulk import
-- Tables: vendors, vendor_imports (ERD §3.2).
-- One vendor_imports row per bulk upload; one vendors row per valid line.
-- All writes go through the import_vendors() RPC (SECURITY DEFINER), the same
-- pattern handle_new_user() uses in 0001_core.sql. RLS still isolates every
-- read by organization_id (ERD §6.3).

-- 1. vendor_imports ----------------------------------------------------------
-- One row per bulk upload or ERP sync batch, for traceability.
-- Created before vendors because vendors.import_id references it.
create table if not exists public.vendor_imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source          text not null
                    check (source in ('tally_export', 'excel', 'erp_sync')),
  row_count       int not null default 0,
  error_count     int not null default 0,
  status          text not null default 'processing'
                    check (status in ('processing', 'completed', 'completed_with_errors')),
  created_at      timestamptz not null default now()
);

create index if not exists vendor_imports_organization_id_idx
  on public.vendor_imports (organization_id);

-- 2. vendors -----------------------------------------------------------------
-- The vendor master. One row per vendor per organization.
create table if not exists public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null,
  gstin               text,          -- nullable: not every vendor is GST-registered
  udyam_number        text,          -- nullable, format UDYAM-XX-00-0000000
  pan                 text,          -- personal data if proprietor (ERD §6.3)
  current_gst_status  text not null default 'unknown'
                        check (current_gst_status in
                          ('active', 'inactive', 'cancelled', 'not_applicable', 'unknown')),
  current_msme_status text not null default 'unknown'
                        check (current_msme_status in
                          ('registered', 'lapsed', 'not_msme', 'unknown')),
  current_bank_status text not null default 'unverified'
                        check (current_bank_status in ('verified', 'mismatch', 'unverified')),
  source              text check (source in ('tally', 'excel', 'erp_sync')),
  import_id           uuid references public.vendor_imports (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists vendors_organization_id_idx on public.vendors (organization_id);
create index if not exists vendors_import_id_idx       on public.vendors (import_id);
create index if not exists vendors_gstin_idx           on public.vendors (gstin);

-- Note: no unique (organization_id, gstin). Dedupe is scoped to a single upload
-- (ERD §7); a global constraint would block legitimate re-imports. Left as a
-- possible future guard.

-- 3. Atomic insert RPC -------------------------------------------------------
-- Inserts the vendor_imports batch row and all vendor rows in ONE transaction.
-- SECURITY DEFINER so it bypasses RLS (like handle_new_user); it stamps
-- organization_id = current_org_id() itself, so a caller can only ever write to
-- their own org. The caller validates and dedupes in memory first, so the final
-- row_count / error_count / status are known before any write — 'processing' is
-- never persisted.
create or replace function public.import_vendors(
  p_source      text,
  p_row_count   int,
  p_error_count int,
  p_vendors     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id    uuid;
  v_import_id uuid;
begin
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'no organization for the current user';
  end if;

  insert into public.vendor_imports (organization_id, source, row_count, error_count, status)
  values (
    v_org_id,
    p_source,
    p_row_count,
    p_error_count,
    case when p_error_count > 0 then 'completed_with_errors' else 'completed' end
  )
  returning id into v_import_id;

  insert into public.vendors (
    organization_id, name, gstin, udyam_number, pan,
    current_gst_status, current_msme_status, current_bank_status,
    source, import_id
  )
  select
    v_org_id,
    v.name,
    v.gstin,
    v.udyam_number,
    v.pan,
    coalesce(v.current_gst_status, 'unknown'),
    coalesce(v.current_msme_status, 'unknown'),
    coalesce(v.current_bank_status, 'unverified'),
    coalesce(v.source, 'excel'),
    v_import_id
  from jsonb_to_recordset(p_vendors) as v(
    name                text,
    gstin               text,
    udyam_number        text,
    pan                 text,
    current_gst_status  text,
    current_msme_status text,
    current_bank_status text,
    source              text
  );

  return v_import_id;
end;
$$;

-- 4. Row Level Security ------------------------------------------------------
alter table public.vendor_imports enable row level security;
alter table public.vendors        enable row level security;

-- A user reads only their own organization's rows.
drop policy if exists vendor_imports_select_own on public.vendor_imports;
create policy vendor_imports_select_own
  on public.vendor_imports for select
  to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists vendors_select_own on public.vendors;
create policy vendors_select_own
  on public.vendors for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policies for `authenticated`: normal users cannot
-- write these tables directly. The import_vendors() RPC owns all inserts,
-- running as SECURITY DEFINER. Cron/provider jobs use the service role, which
-- bypasses RLS by design (ERD §6.3).

-- 5. Table privileges --------------------------------------------------------
-- PostgREST checks SQL GRANTs BEFORE RLS. Without a grant even the service role
-- gets "permission denied" (42501). `authenticated` gets SELECT only; all writes
-- flow through the SECURITY DEFINER RPC below.
grant select on public.vendor_imports to authenticated;
grant select on public.vendors        to authenticated;

grant all on public.vendor_imports to service_role;
grant all on public.vendors        to service_role;

-- Let authenticated callers run the import RPC (mirrors current_org_id()).
grant execute on function
  public.import_vendors(text, int, int, jsonb) to authenticated;
