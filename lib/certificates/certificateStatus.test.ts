import { describe, it, expect } from "vitest";
import { deriveCertificateStatus } from "./certificateStatus";

describe("deriveCertificateStatus", () => {
  const today = new Date("2026-08-10T12:00:00Z");

  it("is valid when the expiry date is in the future", () => {
    expect(deriveCertificateStatus("2026-08-11", today)).toBe("valid");
  });

  it("is valid when the expiry date is far in the future", () => {
    expect(deriveCertificateStatus("2030-01-01", today)).toBe("valid");
  });

  it("is expired when the expiry date is in the past", () => {
    expect(deriveCertificateStatus("2026-08-09", today)).toBe("expired");
  });

  it("is expired when the expiry date is far in the past", () => {
    expect(deriveCertificateStatus("2020-01-01", today)).toBe("expired");
  });

  it("treats an expiry date of today as still valid (expires at end of day)", () => {
    expect(deriveCertificateStatus("2026-08-10", today)).toBe("valid");
  });
});
