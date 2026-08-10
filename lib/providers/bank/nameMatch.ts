/**
 * Pure name-matching for bank account verification (Chunk 2.1).
 *
 * Compares the vendor's registered name against the bank account holder name
 * a provider returns. Kept pure and separate from any adapter so the
 * classification logic is unit-tested on its own and shared by every adapter.
 */

export type NameMatchResult = "exact" | "partial" | "none";

// Tokens shorter than this are too common/generic to count as a meaningful
// match on their own (e.g. "A", "B", "Co", "Of").
const MIN_TOKEN_LENGTH = 3;

function normalize(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(normalized: string): Set<string> {
  return new Set(
    normalized.split(" ").filter((t) => t.length >= MIN_TOKEN_LENGTH),
  );
}

/** Classify how closely `a` (the vendor name) matches `b` (the holder name). */
export function matchNames(a: string, b: string): NameMatchResult {
  const normA = normalize(a);
  const normB = normalize(b);
  if (normA === normB) return "exact";

  const tokensA = significantTokens(normA);
  const tokensB = significantTokens(normB);
  for (const token of tokensA) {
    if (tokensB.has(token)) return "partial";
  }
  return "none";
}
