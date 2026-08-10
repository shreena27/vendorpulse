import { describe, it, expect } from "vitest";
import {
  createMockAdapter,
  MOCK_GSTIN_ACTIVE,
  MOCK_GSTIN_CANCELLED,
  MOCK_GSTIN_TIMEOUT,
} from "./mockAdapter";
import { expectGstCheckResultShape } from "./shapeAssertions";

describe("mock GST adapter", () => {
  const adapter = createMockAdapter();

  it("returns ACTIVE for the active fixture", async () => {
    const result = await adapter.checkGstin(MOCK_GSTIN_ACTIVE);
    expectGstCheckResultShape(result);
    expect(result.status).toBe("ACTIVE");
    expect(result.provider).toBe("mock");
    expect(result.error).toBeUndefined();
  });

  it("returns CANCELLED for the cancelled fixture", async () => {
    const result = await adapter.checkGstin(MOCK_GSTIN_CANCELLED);
    expectGstCheckResultShape(result);
    expect(result.status).toBe("CANCELLED");
    expect(result.rawStatus).toBe("Cancelled");
  });

  it("returns UNKNOWN + timeout error for the timeout fixture", async () => {
    const result = await adapter.checkGstin(MOCK_GSTIN_TIMEOUT);
    expectGstCheckResultShape(result);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("timeout");
  });

  it("rejects a malformed GSTIN without throwing", async () => {
    const result = await adapter.checkGstin("not-a-gstin");
    expectGstCheckResultShape(result);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("invalid_gstin");
  });

  it("normalizes case and whitespace", async () => {
    const result = await adapter.checkGstin(`  ${MOCK_GSTIN_ACTIVE.toLowerCase()}  `);
    expect(result.gstin).toBe(MOCK_GSTIN_ACTIVE);
    expect(result.status).toBe("ACTIVE");
  });
});
