/**
 * Which alert statuses are terminal (Chunk 3.3 bugfix). One source of truth
 * for the "Needs action" vs "Resolved" split — used by the alert inbox UI so
 * this decision can't silently drift from resolve_alert()'s own guard
 * (supabase/migrations/0014_resolve_alert_terminal_status.sql).
 *
 * 'hold' and 'escalated' are deliberately NOT terminal: holding a payment or
 * escalating to someone else doesn't mean the underlying vendor issue is
 * resolved. Only 'reviewed' (and, later, an explicit 'cleared') closes an
 * alert out.
 */

import type { AlertStatus } from "@/lib/supabase/types";

const TERMINAL_STATUSES: readonly AlertStatus[] = ["reviewed", "cleared"];

export function isTerminalAlertStatus(status: AlertStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
