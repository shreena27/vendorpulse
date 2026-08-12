"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AlertWithNudge } from "@/lib/alerts/queries";

type Chip = "action" | "resolved" | "all";
type Action = "hold" | "reviewed" | "escalate";

const CHIPS: { key: Chip; label: string }[] = [
  { key: "action", label: "Needs action" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

const ACTION_LABELS: Record<Action, string> = {
  hold: "Hold",
  reviewed: "Mark reviewed",
  escalate: "Escalate",
};

// Past-tense, human-agency phrasing — the finance head decided, the system
// only asked. Keyed by the resulting alert status, not the action verb
// (escalate -> escalated).
const RESOLVED_VERB_PHRASE: Record<string, string> = {
  hold: "held these payments",
  reviewed: "marked this reviewed",
  escalated: "escalated this alert",
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
      if (chip === "action") return a.resolvedAt === null;
      if (chip === "resolved") return a.resolvedAt !== null;
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
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No alerts yet. They&rsquo;ll show up here when a vendor&rsquo;s status changes
        while a payment is pending.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1" role="group" aria-label="Filter alerts">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            aria-pressed={chip === c.key}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              chip === c.key
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "border border-black/[.12] hover:bg-black/[.04] dark:border-white/[.16] dark:hover:bg-white/[.06]"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No alerts match this filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-black/[.08] p-4 dark:border-white/[.12]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <Link
                    href={`/vendors/${a.vendorId}`}
                    className="w-fit font-medium text-black underline-offset-4 hover:underline dark:text-zinc-50"
                  >
                    {a.vendorName}
                  </Link>
                  <p className="text-sm text-black dark:text-zinc-50">{a.nudge.changeLine}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.nudge.impactLine}</p>
                  {/* Only an alert still needing action asks a question — a
                      resolved one gets its own past-tense line below instead. */}
                  {!a.resolvedAt && (
                    <p className="text-sm font-medium text-black dark:text-zinc-50">
                      {a.nudge.question}
                    </p>
                  )}
                </div>

                {a.resolvedAt ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {a.resolvedByName ?? "A team member"}{" "}
                    {RESOLVED_VERB_PHRASE[a.status] ?? "resolved this alert"} on{" "}
                    {fmtDate(a.resolvedAt)}.
                  </p>
                ) : (
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-2">
                      {(Object.keys(ACTION_LABELS) as Action[]).map((action) => (
                        <button
                          key={action}
                          type="button"
                          disabled={pendingId === a.id}
                          onClick={() => act(a.id, action)}
                          className="rounded-full border border-black/[.12] px-3 py-1 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.16] dark:hover:bg-white/[.06]"
                        >
                          {ACTION_LABELS[action]}
                        </button>
                      ))}
                    </div>
                    {errorById[a.id] && (
                      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                        {errorById[a.id]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
