/**
 * Parse a vendor list (CSV or XLSX) into a header list plus data rows.
 *
 * Runs in both the browser (the import page reads headers to build the mapping
 * UI) and Node (the route handler re-parses the same file as the source of
 * truth — it never trusts rows sent from the client).
 *
 * SheetJS is imported lazily so it lands in its own async chunk, not the main
 * client bundle. We pin the patched CDN build (see package.json), which fixes
 * the prototype-pollution advisory in the stale npm-registry `xlsx`.
 */

export type ParsedFile = {
  /** Column names from the first row, trimmed, in original order. */
  headers: string[];
  /** One object per data row, keyed by header name. Every value is a string. */
  rows: Record<string, string>[];
};

/** Accepted parse input. A browser `File` also satisfies `arrayBuffer()`. */
type ParseInput = ArrayBuffer | Uint8Array | { arrayBuffer(): Promise<ArrayBuffer> };

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** Strip a leading UTF-8 BOM that would otherwise corrupt the first header. */
function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export async function parseVendorFile(input: ParseInput): Promise<ParsedFile> {
  const buffer =
    input instanceof ArrayBuffer || input instanceof Uint8Array
      ? toUint8Array(input)
      : toUint8Array(await input.arrayBuffer());

  const XLSX = await import("xlsx");

  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], rows: [] };
  }

  const sheet = workbook.Sheets[firstSheetName];

  // `header: 1` returns an array-of-arrays (row 0 is the header row).
  // `raw: false` forces string output, so GSTIN/PAN/Udyam keep leading zeros
  // and are never reinterpreted as numbers or dates. `defval: ""` fills blanks.
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = (matrix[0] ?? []).map((h, i) =>
    stripBom(String(h ?? "").trim()) || `Column ${i + 1}`,
  );

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    // Skip a row that is entirely empty.
    if (cells.every((c) => String(c ?? "").trim() === "")) {
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((header, c) => {
      row[header] = String(cells[c] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}
