-- Chunk 2.1 — Bank account verification (Eko) + mock
-- Table: bank_verifications (ERD §3.2). One-time, per-vendor bank check run
-- right after import, or re-run on a manual flag. The raw account number is
-- NEVER stored here or anywhere else — only a masked value (last 4 digits)
-- and the IFSC (not sensitive) persist. Writes go through a SECURITY
-- DEFINER RPC, same pattern as import_vendors (0002) — `authenticated` has
-- SELECT only.

-- 1. bank_verifications --------------------------------------------------
create table if not exists public.bank_verifications (
  id                     uuid primary key default gen_random_uuid(),
  -- organization_id is denormalized from the vendor, same as
  -- verification_checks (0003), so RLS can reuse the same org-scoped policy.
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  vendor_id              uuid not null references public.vendors (id) on delete cascade,
  account_number_masked  text not null,   -- e.g. "****3456"; full number never persisted
  ifsc                   text not null,
  name_match_result      text not null check (name_match_result in ('exact', 'partial', 'none')),
  status                 text not null check (status in ('verified', 'manual_review', 'mismatch')),
  provider               text not null check (provider in ('eko', 'mock')),
  re_verified_reason     text,            -- null for the automatic onboarding check
  checked_at             timestamptz not null default now()
);

create index if not exists bank_verifications_vendor_id_idx
  on public.bank_verifications (vendor_id);
create index if not exists bank_verifications_organization_id_idx
  on public.bank_verifications (organization_id);

-- 2. Widen vendors.current_bank_status to add 'manual_review' -------------
-- The column's CHECK constraint (0002) only allows verified/mismatch/
-- unverified. Look up its actual auto-generated name instead of guessing it,
-- so this works regardless of what Postgres assigned.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.vendors'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%current_bank_status%';

  if v_constraint_name is not null then
    execute format('alter table public.vendors drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.vendors add constraint vendors_current_bank_status_check
  check (current_bank_status in ('verified', 'manual_review', 'mismatch', 'unverified'));

-- 3. Row Level Security ----------------------------------------------------
alter table public.bank_verifications enable row level security;

-- A user reads only their own organization's bank checks.
drop policy if exists bank_verifications_select_own on public.bank_verifications;
create policy bank_verifications_select_own
  on public.bank_verifications for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated`: this table is
-- append-only and only the record_bank_verification() RPC below writes it.

-- 4. record_bank_verification() RPC ----------------------------------------
-- Inserts one bank_verifications row and updates the vendor's
-- current_bank_status in one transaction. SECURITY DEFINER so it bypasses
-- RLS (like import_vendors); it validates the vendor belongs to the caller's
-- own org before writing anything, so a caller can never write against
-- another org's vendor.
create or replace function public.record_bank_verification(
  p_vendor_id             uuid,
  p_account_number_masked text,
  p_ifsc                  text,
  p_name_match_result     text,
  p_status                text,
  p_provider              text,
  p_re_verified_reason    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_id     uuid;
begin
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'no organization for the current user';
  end if;

  if not exists (
    select 1 from public.vendors
    where id = p_vendor_id and organization_id = v_org_id
  ) then
    raise exception 'vendor not found in the current organization';
  end if;

  insert into public.bank_verifications (
    organization_id, vendor_id, account_number_masked, ifsc,
    name_match_result, status, provider, re_verified_reason
  )
  values (
    v_org_id, p_vendor_id, p_account_number_masked, p_ifsc,
    p_name_match_result, p_status, p_provider, p_re_verified_reason
  )
  returning id into v_id;

  update public.vendors
  set current_bank_status = p_status, updated_at = now()
  where id = p_vendor_id;

  return v_id;
end;
$$;

-- 5. Table privileges --------------------------------------------------------
-- PostgREST checks SQL GRANTs BEFORE RLS (the recurring 42501 lesson).
grant select on public.bank_verifications to authenticated;
grant all    on public.bank_verifications to service_role;

grant execute on function
  public.record_bank_verification(uuid, text, text, text, text, text, text) to authenticated;
