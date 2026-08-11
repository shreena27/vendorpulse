-- Chunk 4.3 — LEI pre-payment check
-- Adds vendors.lei_number: the vendor's Legal Entity Identifier, when known.
-- Nullable and free-standing, same pattern as gstin/udyam_number — most
-- vendors will never have one; it's only relevant ahead of a large
-- RTGS/NEFT payment (>= 50cr). A null value here is exactly "no LEI on
-- file" (ERD acceptance criterion) and resolves to not_on_record without
-- ever calling GLEIF.

alter table public.vendors
  add column if not exists lei_number text; -- ISO 17442: 20 alphanumeric chars

create index if not exists vendors_lei_number_idx on public.vendors (lei_number);
