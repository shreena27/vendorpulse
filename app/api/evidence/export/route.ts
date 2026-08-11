import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCallerContext } from "@/lib/vendors/queries";
import { buildExport } from "@/lib/evidence/buildExport";
import { formatExportCsv } from "@/lib/evidence/formatCsv";
import { formatExportPdf } from "@/lib/evidence/formatPdf";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORMATS = new Set(["csv", "pdf"]);

// GET /api/evidence/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|pdf
// Clause 22 / Form 3CD export (ERD §4, §5.4). finance_head/admin only.
// Built from evidence_log, not live vendor state — see lib/evidence/buildExport.ts.
export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const caller = await getCallerContext(supabase);
  if (!caller?.canSeePii) {
    return NextResponse.json(
      { error: "Only a finance head or admin may export evidence." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const format = url.searchParams.get("format") ?? "csv";

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: "from and to are required, as YYYY-MM-DD dates." },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json({ error: "from must not be after to." }, { status: 400 });
  }
  if (!FORMATS.has(format)) {
    return NextResponse.json({ error: `Invalid format: ${format}. Use csv or pdf.` }, { status: 400 });
  }

  const rows = await buildExport(supabase, { from, to });
  const filenameBase = `evidence-export-${from}-to-${to}`;

  if (format === "pdf") {
    const pdf = await formatExportPdf(rows, { from, to });
    // Buffer<ArrayBufferLike> doesn't structurally satisfy NextResponse's
    // BodyInit type (DOM lib expects a plain ArrayBuffer-backed view) — a
    // Uint8Array view over the same bytes does, with no copy.
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
      },
    });
  }

  const csv = formatExportCsv(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
