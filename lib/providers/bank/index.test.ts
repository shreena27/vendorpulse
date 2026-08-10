import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getBankAdapter, resetBankAdapter } from "./index";

describe("bank adapter selector", () => {
  const original = process.env.BANK_PROVIDER;

  beforeEach(() => resetBankAdapter());
  afterEach(() => {
    if (original === undefined) delete process.env.BANK_PROVIDER;
    else process.env.BANK_PROVIDER = original;
    resetBankAdapter();
  });

  it("defaults to the mock adapter when BANK_PROVIDER is unset", () => {
    delete process.env.BANK_PROVIDER;
    expect(getBankAdapter().name).toBe("mock");
  });

  it("selects the eko adapter when BANK_PROVIDER=eko", () => {
    process.env.BANK_PROVIDER = "eko";
    expect(getBankAdapter().name).toBe("eko");
  });

  it("memoizes the chosen adapter across calls", () => {
    delete process.env.BANK_PROVIDER;
    expect(getBankAdapter()).toBe(getBankAdapter());
  });
});
