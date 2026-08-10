import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthorizedCron } from "./cronAuth";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/cron/poll-gst", { headers });
}

describe("isAuthorizedCron", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("accepts the correct Bearer token", () => {
    expect(isAuthorizedCron(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedCron(req())).toBe(false);
  });

  it("rejects a wrong token", () => {
    expect(isAuthorizedCron(req({ authorization: "Bearer nope" }))).toBe(false);
  });

  it("rejects a bare token without the Bearer prefix", () => {
    expect(isAuthorizedCron(req({ authorization: "s3cret" }))).toBe(false);
  });

  it("fails closed when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(req({ authorization: "Bearer s3cret" }))).toBe(false);
  });
});
