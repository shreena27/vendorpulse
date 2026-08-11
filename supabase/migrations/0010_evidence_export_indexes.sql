-- Chunk 4.2 — Clause 22 / Form 3CD export
-- New range-query access patterns: "every payment due in [from, to]"
-- (payments.due_date) and "every msme_udyam verification_check for a vendor
-- set, created_at <= cutoff, ordered ascending" (evidence_log). Neither
-- shape is served by an existing index — evidence_log (0009) is indexed on
-- organization_id, vendor_id, and (entity_type, entity_id); payments (0006)
-- is indexed on vendor_id and (vendor_id, status) only.
--
-- No table/RLS/grant changes — indexes only, no new table.

create index if not exists evidence_log_vendor_event_created_idx
  on public.evidence_log (vendor_id, event_type, created_at);

create index if not exists payments_due_date_idx
  on public.payments (due_date);
