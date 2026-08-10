/**
 * Cron endpoint authorization (ERD §6.1).
 *
 * The poll routes must be triggerable only by the scheduler, never publicly.
 * Vercel Cron adds `Authorization: Bearer $CRON_SECRET` to every invocation; we
 * verify it here. Fails closed: if CRON_SECRET is unset, nothing is authorized.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
