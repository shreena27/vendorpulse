import { describe, it, expect, vi } from "vitest";
import { sendAlertEmail, type ResendClient } from "./sendAlertEmail";

const baseInput = {
  to: ["finance@example.com"],
  vendorName: "Vendor X",
  changeLine: "Vendor X's GST registration just went inactive.",
  impactLine: "2 pending payments total ₹4.1L.",
  question: "Hold them?",
};

function stubClient(error: { message: string } | null = null) {
  const send = vi.fn().mockResolvedValue({
    data: error ? null : { id: "email-1" },
    error,
  });
  return { client: { emails: { send } } as unknown as ResendClient, send };
}

describe("sendAlertEmail", () => {
  it("sends to the given recipients with the vendor name and the exact nudge copy in the body", async () => {
    const { client, send } = stubClient();

    await sendAlertEmail(client, baseInput);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.to).toEqual(["finance@example.com"]);
    expect(payload.subject).toContain("Vendor X");
    expect(payload.text).toContain(baseInput.changeLine);
    expect(payload.text).toContain(baseInput.impactLine);
    expect(payload.text).toContain(baseInput.question);
  });

  it("sends to multiple recipients when given multiple addresses", async () => {
    const { client, send } = stubClient();
    await sendAlertEmail(client, { ...baseInput, to: ["a@example.com", "b@example.com"] });
    expect(send.mock.calls[0][0].to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("throws when Resend returns an error", async () => {
    const { client } = stubClient({ message: "invalid recipient" });
    await expect(sendAlertEmail(client, baseInput)).rejects.toThrow(/invalid recipient/);
  });

  it("never implies the system already acted in the email body", async () => {
    const { client, send } = stubClient();
    await sendAlertEmail(client, baseInput);
    const text: string = send.mock.calls[0][0].text;
    expect(text).not.toMatch(/automatically/i);
    expect(text).not.toMatch(/has been held/i);
  });
});
