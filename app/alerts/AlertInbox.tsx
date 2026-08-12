"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AlertWithNudge } from "@/lib/alerts/queries";
import { isTerminalAlertStatus } from "@/lib/alerts/alertStatus";

type Chip = "action" | "resolved" | "all";
type Action = "hold" | "reviewed" | "escalate";

// Exactly the 3 real filter states this app has (all/action/resolved) —
// Stitch's reference shows a 4-tab All/Open/Held/Resolved row, but there's
// no "Open" vs "Held" distinction in the filtering logic below, so no 4th
// chip was added. Ordered to put "All" first, matching Stitch's own tab
// order and this component's own default state.
const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Needs action" },
  { key: "resolved", label: "Resolved" },
];

const ACTION_LABELS: Record<Action, string> = {
  hold: "Hold",
  reviewed: "Mark reviewed",
  escalate: "Escalate",
};

// Stitch styles each action button distinctly (filled/outline/outline-error).
// Escalate borrows the error color since it's the most urgent action.
const ACTION_STYLES: Record<Action, string> = {
  hold: "bg-primary text-on-primary hover:bg-on-primary-fixed",
  reviewed: "border border-outline text-on-surface hover:bg-surface-container-low",
  escalate: "border border-error text-error hover:bg-error-container/40",
};

// Past-tense, human-agency phrasing — the finance head decided, the system
// only asked. Keyed by the resulting alert status, not the action verb
// (escalate -> escalated). Used both for the terminal ("reviewed") card
// text and for the in-progress badge shown on a still-open hold/escalated
// alert — same wording either way, just different placement.
const RESOLVED_VERB_PHRASE: Record<string, string> = {
  hold: "held these payments",
  reviewed: "marked this reviewed",
  escalated: "escalated this alert",
};

// A small category pill derived from the real trigger_type field. Stitch's
// reference also shows a "High Risk"/"Medium Risk" severity tag, but
// AlertWithNudge has no risk-severity field anywhere in this app — there's
// no real data to back one, so only this real, already-available
// distinction (gst_change/msme_change/lei_check) is shown.
const TRIGGER_LABEL: Record<AlertWithNudge["triggerType"], string> = {
  gst_change: "GST",
  msme_change: "MSME",
  lei_check: "LEI",
};

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export function AlertInbox({ alerts: initialAlerts }: { alerts: AlertWithNudge[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  // Default to "all" (matches VendorList's default) so resolving an alert
  // doesn't make its card silently vanish from view — the confirmation
  // stays visible right where the user just acted on it.
  const [chip, setChip] = useState<Chip>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      // "Needs action" / "Resolved" is a status-terminality split, not a
      // resolvedAt-is-set split: hold and escalated both set resolvedAt
      // (who/when last acted) without closing the alert out.
      if (chip === "action") return !isTerminalAlertStatus(a.status);
      if (chip === "resolved") return isTerminalAlertStatus(a.status);
      return true;
    });
  }, [alerts, chip]);

  async function act(alertId: string, action: Action) {
    setPendingId(alertId);
    setErrorById((prev) => ({ ...prev, [alertId]: "" }));
    try {
      const res = await fetch(`/api/alerts/${alertId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorById((prev) => ({ ...prev, [alertId]: data.error ?? "Action failed." }));
        return;
      }
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId
            ? {
                ...a,
                status: data.alert.status,
                resolvedBy: data.alert.resolved_by,
                resolvedByName: "You",
                resolvedAt: data.alert.resolved_at,
              }
            : a,
        ),
      );
    } catch {
      setErrorById((prev) => ({
        ...prev,
        [alertId]: "Action failed. Check your connection and try again.",
      }));
    } finally {
      setPendingId(null);
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="ambient-shadow rounded-xl border border-surface-container bg-surface-container-lowest p-gutter text-center">
        <p className="font-body-md text-body-md text-on-surface-variant">
          No alerts yet. They&rsquo;ll show up here when a vendor&rsquo;s status changes
          while a payment is pending.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack-md">
      <div
        className="flex items-center gap-2 overflow-x-auto border-b border-surface-variant pb-1"
        role="group"
        aria-label="Filter alerts"
      >
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            aria-pressed={chip === c.key}
            className={`whitespace-nowrap border-b-2 px-4 py-2 font-label-md text-label-md transition-colors ${
              chip === c.key
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="ambient-shadow rounded-xl border border-surface-container bg-surface-container-lowest p-gutter text-center">
          <p className="font-body-md text-body-md text-on-surface-variant">
            No alerts match this filter.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-stack-md">
          {filtered.map((a) => {
            const terminal = isTerminalAlertStatus(a.status);
            // Once any action has been taken (hold/escalate), the original
            // "Hold them?" question no longer applies — but the alert isn't
            // closed out until it reaches a terminal status.
            const actioned = a.status !== "open";
            return (
            <li
              key={a.id}
              className={`ambient-shadow card-border relative flex flex-col gap-gutter overflow-hidden rounded-xl bg-surface-container-lowest p-gutter transition-shadow hover:shadow-[0px_10px_30px_rgba(15,23,42,0.08)] md:flex-row md:items-start ${
                terminal ? "opacity-90" : ""
              }`}
            >
              {!terminal && (
                <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary-container" />
              )}

              <div className="flex flex-1 flex-col gap-stack-sm">
                <div className="flex flex-wrap items-center justify-between gap-stack-sm">
                  <Link
                    href={`/vendors/${a.vendorId}`}
                    className="font-headline-md text-headline-md text-on-surface underline-offset-4 hover:underline"
                  >
                    {a.vendorName}
                  </Link>
                  <span className="flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant">
                    <span aria-hidden className="material-symbols-outlined text-[16px]">
                      schedule
                    </span>
                    {fmtDate(a.createdAt)}
                  </span>
                </div>

                <p className="font-body-md text-body-md text-on-surface">{a.nudge.changeLine}</p>
                <p className="font-body-md text-body-md text-on-surface-variant">{a.nudge.impactLine}</p>
                {/* Only a fresh, not-yet-actioned alert asks a question — a
                    held/escalated/reviewed one gets its own past-tense line
                    instead (as a badge if still open, or the terminal block
                    below once resolved). */}
                {!actioned && (
                  <p className="font-label-md text-label-md text-on-surface">{a.nudge.question}</p>
                )}

                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-surface-container px-2 py-1 font-label-sm text-label-sm text-on-surface-variant">
                    {TRIGGER_LABEL[a.triggerType]}
                  </span>
                </div>
              </div>

              <div className="flex w-full shrink-0 flex-row gap-stack-sm overflow-x-auto border-t border-surface-variant pt-gutter md:w-auto md:flex-col md:border-l md:border-t-0 md:pl-gutter md:pt-0">
                {terminal ? (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {a.resolvedByName ?? "A team member"}{" "}
                    {RESOLVED_VERB_PHRASE[a.status] ?? "resolved this alert"} on{" "}
                    {fmtDate(a.resolvedAt!)}.
                  </p>
                ) : (
                  <div className="flex flex-col items-end gap-2">
                    {/* Still-open alert that's already been held or
                        escalated: say so, but keep every action available —
                        escalating hands the decision to someone else, it
                        doesn't close the alert (that's the bug this fixes). */}
                    {actioned && (
                      <p className="font-body-sm text-body-sm text-on-surface-variant">
                        {a.resolvedByName ?? "A team member"}{" "}
                        {RESOLVED_VERB_PHRASE[a.status] ?? "acted on this alert"} on{" "}
                        {fmtDate(a.resolvedAt!)}.
                      </p>
                    )}
                    <div className="flex flex-row gap-2 md:flex-col">
                      {(Object.keys(ACTION_LABELS) as Action[]).map((action) => (
                        <button
                          key={action}
                          type="button"
                          disabled={pendingId === a.id}
                          onClick={() => act(a.id, action)}
                          className={`whitespace-nowrap rounded px-4 py-2 font-label-md text-label-md transition-colors disabled:opacity-40 ${ACTION_STYLES[action]}`}
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      ))}
                    </div>
                    {errorById[a.id] && (
                      <p role="alert" className="font-body-sm text-body-sm text-error">
                        {errorById[a.id]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
