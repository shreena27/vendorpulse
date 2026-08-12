-- Chunk 3.3 bugfix — escalating an alert incorrectly closed it out.
--
-- resolve_alert() (migration 0008) guarded its atomic UPDATE with
-- `resolved_at is null`, and set resolved_at on every action (hold,
-- reviewed, escalate) alike. The alert inbox UI treats `resolved_at !==
-- null` as "this alert is done" — so escalating (and holding) both looked
-- indistinguishable from a genuine resolution: the card moved to the
-- Resolved tab and lost its action buttons.
--
-- Escalating hands the decision to someone else; it doesn't mean the
-- underlying vendor issue is fixed. Holding a payment doesn't either. Only
-- 'reviewed' (and, later, an explicit 'cleared'/"Resolve") should close an
-- alert out. This migration re-points the guard at `status`, not
-- `resolved_at` — hold/escalate stay actionable (an escalated alert can
-- still be marked reviewed later); only a terminal status blocks further
-- action with `alert_already_resolved`.
--
-- resolved_by/resolved_at keep their existing meaning of "who/when the
-- current status was last set" — they're still updated on every action,
-- now just no longer used as the terminal signal.

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
  -- org's scope AND not already in a terminal status. 'hold' and
  -- 'escalated' are NOT terminal — an alert sitting in either of those
  -- states can still be acted on again (e.g. escalated -> reviewed).
  update public.alerts
  set status = v_status, resolved_by = auth.uid(), resolved_at = now()
  where id = p_alert_id
    and organization_id = v_org_id
    and status not in ('reviewed', 'cleared')
  returning * into v_row;

  if v_row.id is null then
    -- Distinguish 404 (wrong org / doesn't exist) from 409 (already in a
    -- terminal status) with one more org-scoped existence check.
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
