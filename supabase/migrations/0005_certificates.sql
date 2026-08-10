-- Chunk 2.2 — Certificate upload
-- Table: certificates (ERD §3.2). Insurance/safety documents uploaded once
-- at onboarding; status (valid/expired) is computed once, at upload time,
-- from the expiry date — there is no ongoing/scheduled recheck in v1.
--
-- The private `certificates` Storage bucket has its OWN, separate RLS layer
-- on storage.objects (distinct from the Postgres RLS below). Both layers
-- independently enforce organization isolation.

-- 1. certificates -------------------------------------------------------
create table if not exists public.certificates (
  id                uuid primary key default gen_random_uuid(),
  -- organization_id is denormalized from the vendor, same as
  -- bank_verifications (0004), so RLS can reuse the same org-scoped policy.
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  vendor_id         uuid not null references public.vendors (id) on delete cascade,
  certificate_type  text not null,   -- free text; the ERD defines no closed enum
  file_path         text not null,   -- the Storage object path; never a public URL
  expiry_date       date not null,
  status            text not null check (status in ('valid', 'expired')),
  uploaded_at       timestamptz not null default now()
);

create index if not exists certificates_vendor_id_idx
  on public.certificates (vendor_id);
create index if not exists certificates_organization_id_idx
  on public.certificates (organization_id);

-- 2. Row Level Security (Postgres table) -------------------------------
alter table public.certificates enable row level security;

-- A user reads only their own organization's certificates.
drop policy if exists certificates_select_own on public.certificates;
create policy certificates_select_own
  on public.certificates for select
  to authenticated
  using (organization_id = public.current_org_id());

-- No INSERT/UPDATE/DELETE policy for `authenticated`: writes go through the
-- create_certificate() RPC below, same pattern as import_vendors (0002) and
-- record_bank_verification (0004).

-- 3. create_certificate() RPC -------------------------------------------
-- Inserts one certificates row. SECURITY DEFINER so it bypasses RLS (like
-- the prior write RPCs); validates the vendor belongs to the caller's own
-- org before writing anything, so a caller can never write against another
-- org's vendor. `p_status` is computed by the caller (deriveCertificateStatus,
-- lib/certificates/certificateStatus.ts) from the expiry date — this
-- function does not re-derive it, so the app's status logic stays in one
-- place.
create or replace function public.create_certificate(
  p_vendor_id        uuid,
  p_certificate_type text,
  p_file_path        text,
  p_expiry_date      date,
  p_status           text
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

  insert into public.certificates (
    organization_id, vendor_id, certificate_type, file_path, expiry_date, status
  )
  values (
    v_org_id, p_vendor_id, p_certificate_type, p_file_path, p_expiry_date, p_status
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 4. Table privileges (Postgres table) -----------------------------------
-- PostgREST checks SQL GRANTs BEFORE RLS (the recurring 42501 lesson).
grant select on public.certificates to authenticated;
grant all    on public.certificates to service_role;

grant execute on function
  public.create_certificate(uuid, text, text, date, text) to authenticated;

-- 5. Storage bucket -------------------------------------------------------
-- PRIVATE bucket (public = false): every read goes through a short-lived
-- signed URL generated server-side (lib/storage/certificateUrl.ts). The MIME
-- allowlist is defense-in-depth alongside the app-level check
-- (lib/certificates/validateCertificateFile.ts) — Storage itself refuses a
-- disallowed type even if the app check were ever bypassed.
insert into storage.buckets (id, name, public, allowed_mime_types)
values (
  'certificates',
  'certificates',
  false,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- 6. Storage RLS (storage.objects) — the SEPARATE policy layer -----------
-- RLS is already enabled on storage.objects by Supabase by default. Objects
-- are stored at "{organization_id}/{vendor_id}/{timestamp}_{filename}", so
-- the first path segment IS the org id — the standard Supabase folder-based
-- multi-tenant pattern. This is real, independent enforcement: even a
-- path-building bug in application code cannot read or write another org's
-- folder, because Postgres evaluates this policy regardless of what the app
-- intended.
drop policy if exists certificates_bucket_insert_own_org on storage.objects;
create policy certificates_bucket_insert_own_org
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

drop policy if exists certificates_bucket_select_own_org on storage.objects;
create policy certificates_bucket_select_own_org
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

-- DELETE is needed because lib/storage/uploadCertificate.ts's cleanup path
-- removes an object it just inserted when the follow-up create_certificate()
-- call fails — without this policy, that cleanup would itself silently fail,
-- leaving an orphaned object despite the caller seeing an error either way.
drop policy if exists certificates_bucket_delete_own_org on storage.objects;
create policy certificates_bucket_delete_own_org
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'certificates'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );
