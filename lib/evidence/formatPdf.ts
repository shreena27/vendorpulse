/**
 * PDF rendering for the Clause 22 / Form 3CD export (Chunk 4.2), via
 * `pdfkit`. `PDFDocument` is a Node `Readable` stream, not directly
 * awaitable — wrapped in a Promise here so the route can just
 * `await formatExportPdf(...)` and hand the resulting Buffer straight to
 * `NextResponse` (a Buffer is a valid BodyInit). Buffered, not streamed —
 * fine at this project's pilot scale (100-300 vendors); no precedent for a
 * streaming Route Handler response in this codebase either.
 *
 * pdfkit has no auto-table support, so pagination is manual (addPage() when
 * the cursor crosses the bottom margin).
 */

import PDFDocument from "pdfkit";
import type { EvidenceExportRow } from "./buildExport";
import { formatMsmeStatusLabel } from "./msmeStatusLabel";

export interface PdfExportRange {
  from: string;
  to: string;
}

const MARGIN = 50;
const ROW_HEIGHT = 18;

export async function formatExportPdf(
  rows: EvidenceExportRow[],
  range: PdfExportRange,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("VendorPulse — Clause 22 / Form 3CD Evidence Export", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Range: ${range.from} to ${range.to}`);
    doc.moveDown(1);

    if (rows.length === 0) {
      doc.fontSize(11).text("No payments due in this range.");
      doc.end();
      return;
    }

    const columns = [
      { label: "Due Date", width: 70 },
      { label: "Vendor", width: 160 },
      { label: "GSTIN", width: 100 },
      { label: "Udyam Number", width: 130 },
      { label: "Amount (INR)", width: 90 },
      { label: "Payment Status", width: 90 },
      { label: "MSME Status (as of due date)", width: 130 },
    ];

    function drawHeader(): void {
      doc.fontSize(9).font("Helvetica-Bold");
      // Capture y ONCE before the loop. doc.text() mutates doc.y as a side
      // effect (advances it past the text just drawn) — reading doc.y fresh
      // on every iteration, as this used to, made each successive header
      // drift further down than the last (a staircase, not a row). Header
      // labels are allowed to wrap (they're fixed strings, not arbitrary
      // vendor data), so the row's height is however tall the tallest
      // wrapped label needs, computed up front rather than guessed.
      const y = doc.y;
      const headerHeight = Math.max(
        ...columns.map((col) => doc.heightOfString(col.label, { width: col.width })),
      );
      let x = MARGIN;
      for (const col of columns) {
        doc.text(col.label, x, y, { width: col.width, height: headerHeight, continued: false });
        x += col.width;
      }
      doc.y = y + headerHeight;
      doc.moveDown(0.5);
      doc.font("Helvetica");
    }

    function ensureSpaceForRow(): void {
      if (doc.y + ROW_HEIGHT > doc.page.height - MARGIN) {
        doc.addPage();
        drawHeader();
      }
    }

    drawHeader();
    doc.fontSize(9);
    for (const row of rows) {
      ensureSpaceForRow();
      const y = doc.y;
      let x = MARGIN;
      const cells = [
        row.dueDate,
        row.vendorName,
        row.gstin ?? "",
        row.udyamNumber ?? "",
        row.amount.toFixed(2),
        row.paymentStatus,
        formatMsmeStatusLabel(row.msmeStatus),
      ];
      for (let i = 0; i < columns.length; i++) {
        // height + ellipsis forces a single truncated line ("…") instead of
        // wrapping onto extra lines — a row's height is always exactly
        // ROW_HEIGHT regardless of content length in any column, so a long
        // vendor name can never push the following row's text out of place.
        doc.text(cells[i], x, y, {
          width: columns[i].width,
          height: ROW_HEIGHT - 4,
          ellipsis: true,
        });
        x += columns[i].width;
      }
      doc.y = y + ROW_HEIGHT;
    }

    doc.end();
  });
}
