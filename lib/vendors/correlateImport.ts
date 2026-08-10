/**
 * Correlates in-memory validated import rows back to the vendor rows the
 * `import_vendors` RPC just inserted (Chunk 2.1). `import_vendors` returns
 * only an `import_id`, not per-row vendor ids, so the caller re-selects the
 * inserted vendors afterwards and this pure function pairs them up: by GSTIN
 * when present (unique within an upload — see 0002's dedupe), else by exact
 * name.
 *
 * Known edge case: two GSTIN-less rows sharing an identical name within one
 * import are paired arbitrarily (each inserted vendor is matched exactly
 * once, never double-assigned, but which row gets which id is unspecified).
 * Same spirit as 0002's documented "no unique (org, gstin)" limitation —
 * rare in practice, and never silently double-applies a check.
 */

export interface ImportRowKey {
  name: string;
  gstin: string | null;
}

export interface InsertedVendor {
  id: string;
  name: string;
  gstin: string | null;
}

export function correlateImportedVendors<T extends ImportRowKey>(
  rows: T[],
  insertedVendors: InsertedVendor[],
): Array<T & { vendorId: string | null }> {
  const byGstin = new Map<string, InsertedVendor>();
  const byName = new Map<string, InsertedVendor[]>();
  for (const v of insertedVendors) {
    if (v.gstin) {
      byGstin.set(v.gstin, v);
    } else {
      const pool = byName.get(v.name) ?? [];
      pool.push(v);
      byName.set(v.name, pool);
    }
  }

  return rows.map((row) => {
    if (row.gstin) {
      const match = byGstin.get(row.gstin);
      return { ...row, vendorId: match?.id ?? null };
    }
    const pool = byName.get(row.name);
    const match = pool?.shift();
    return { ...row, vendorId: match?.id ?? null };
  });
}
