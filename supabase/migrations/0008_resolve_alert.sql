-- Chunk 3.3 — Alert inbox: one-tap actions
-- New RPC only, no new table. resolve_alert() is the write path for
-- POST /api/alerts/:id/action — the first authenticated-write capability for
-- `alerts`, implemented as a SECURITY DEFINER RPC (same pattern as every
-- prior user-triggered write: import_vendors, record_bank_verification,
-- create_certificate) rather than a direct UPDATE RLS policy, because the
-- 409-on-already-resolved requirement needs one atomic conditional UPDATE,
-- not a racy select-then-update from application code. No table-level grant
-- change needed: the function runs as its owner, same as every prior write
-- RPC, so `authenticated` still has no direct UPDATE on `alerts`.

create or replace function public.resolve_alert(
  p_alert_id uuid,
  p_action   text  -- 'hold' | 'reviewed' | 'escalate'
)
returns public.alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_status text;
  v_row    public.alerts;
begin
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'no organization for the current user';
  end if;

  -- 'escalate' (the action verb) maps to 'escalated' (the status noun);
  -- hold/reviewed map to themselves. 'cleared' is not a valid action here —
  -- nothing in this chunk sets it.
  v_status := case p_action
    when 'hold' then 'hold'
    when 'reviewed' then 'reviewed'
    when 'escalate' then 'escalated'
    else null
  end;
  if v_status is null then
    raise exception 'invalid_action';
  end if;

  -- The atomic conditional update: only succeeds if the alert is in this
  -- org's scope AND not already resolved. A second call on the same alert
  -- updates zero rows, whether it races the first call or arrives later.
  update public.alerts
  set status = v_status, resolved_by = auth.uid(), resolved_at = now()
  where id = p_alert_id
    and organization_id = v_org_id
    and resolved_at is null
  returning * into v_row;

  if v_row.id is null then
    -- Distinguish 404 (wrong org / doesn't exist) from 409 (already
    -- resolved) with one more org-scoped existence check.
    if exists (
      select 1 from public.alerts where id = p_alert_id and organization_id = v_org_id
    ) then
      raise exception 'alert_already_resolved';
    else
      raise exception 'alert_not_found';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.resolve_alert(uuid, text) to authenticated;
