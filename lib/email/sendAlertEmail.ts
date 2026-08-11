/**
 * Alert email (Chunk 3.3, PRD §4.5). SERVER-ONLY. Reuses the exact same
 * nudge-copy lines the alert inbox UI renders (lib/alerts/nudgeCopy.ts) —
 * one source of truth, so the email and the UI never say different things.
 *
 * Sends via Resend's sandbox sender (onboarding@resend.dev), which only
 * actually delivers to the account's verified signup address until a custom
 * domain is verified — expected for now, not a bug.
 */

const FROM_ADDRESS = "VendorPulse <onboarding@resend.dev>";

export interface SendAlertEmailInput {
  to: string[];
  vendorName: string;
  changeLine: string;
  impactLine: string;
  question: string;
}

/** Minimal Resend client surface this function needs — easy to stub in tests. */
export interface ResendClient {
  emails: {
    send(payload: {
      from: string;
      to: string[];
      subject: string;
      text: string;
    }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  };
}

export async function sendAlertEmail(
  client: ResendClient,
  input: SendAlertEmailInput,
): Promise<void> {
  const { error } = await client.emails.send({
    from: FROM_ADDRESS,
    to: input.to,
    subject: `${input.vendorName}: ${input.changeLine}`,
    text: [input.changeLine, input.impactLine, input.question].join("\n\n"),
  });
  if (error) {
    throw new Error(`send alert email failed: ${error.message}`);
  }
}
