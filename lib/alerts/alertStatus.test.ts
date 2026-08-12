import { describe, it, expect } from "vitest";
import { isTerminalAlertStatus } from "./alertStatus";
import type { AlertStatus } from "@/lib/supabase/types";

describe("isTerminalAlertStatus", () => {
  it("treats reviewed and cleared as terminal", () => {
    expect(isTerminalAlertStatus("reviewed")).toBe(true);
    expect(isTerminalAlertStatus("cleared")).toBe(true);
  });

  it("treats open, hold, and escalated as NOT terminal", () => {
    const nonTerminal: AlertStatus[] = ["open", "hold", "escalated"];
    for (const status of nonTerminal) {
      expect(isTerminalAlertStatus(status)).toBe(false);
    }
  });
});
