"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CERTIFICATE_TYPE_SUGGESTIONS = [
  "Insurance",
  "Safety Certificate",
  "Fire Safety",
  "ISO Certification",
];

export function CertificateUploadForm({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<{
    certificateType: string;
    status: "valid" | "expired";
  } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setLastUploaded(null);

    const form = event.currentTarget;
    const body = new FormData(form);

    try {
      const res = await fetch(`/api/vendors/${vendorId}/certificates`, {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      setLastUploaded({ certificateType: data.certificateType, status: data.status });
      form.reset();
      setFileName(null);
      router.refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="ambient-shadow card-border flex flex-col gap-stack-lg rounded-xl bg-surface-container-lowest p-gutter"
    >
      {/* Certificate type — real free-text input + datalist, kept functionally
          a text field (see CLAUDE.md task note); only the chevron/border
          treatment borrows Stitch's dropdown look. */}
      <div className="flex flex-col gap-stack-sm">
        <label
          htmlFor="cert-type"
          className="font-label-md text-label-md text-on-surface"
        >
          Certificate type
        </label>
        <div className="relative">
          <input
            id="cert-type"
            name="certificateType"
            type="text"
            required
            list="certificate-type-suggestions"
            placeholder="e.g. Insurance"
            className="focus-glow w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3 pr-10 font-body-md text-body-md text-on-surface outline-none transition-all placeholder:text-outline"
          />
          <span
            aria-hidden
            className="material-symbols-outlined pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-on-surface-variant"
          >
            expand_more
          </span>
        </div>
        <datalist id="certificate-type-suggestions">
          {CERTIFICATE_TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {/* File — a real <input type="file"> stretched over a Stitch-style
          dropzone. Clicking anywhere in the box opens the native file
          picker; the input itself carries every attribute the tests and
          the upload route rely on. */}
      <div className="flex flex-col gap-stack-sm">
        <label htmlFor="cert-file" className="font-label-md text-label-md text-on-surface">
          File
        </label>
        <div className="group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low p-stack-lg text-center transition-colors hover:border-primary-container hover:bg-surface-container">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container transition-transform group-hover:scale-110">
            <span
              aria-hidden
              className="material-symbols-outlined text-primary-container"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              upload_file
            </span>
          </div>
          <p className="mb-1 font-body-md text-body-md text-on-surface">
            {fileName ?? "Drag and drop or click to upload"}
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            PDF, JPG, or PNG
          </p>
          <input
            id="cert-file"
            name="file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            required
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>

      <div className="flex flex-col gap-stack-sm">
        <label
          htmlFor="cert-expiry"
          className="font-label-md text-label-md text-on-surface"
        >
          Expiry date
        </label>
        <input
          id="cert-expiry"
          name="expiryDate"
          type="date"
          required
          className="focus-glow w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3 font-body-md text-body-md text-on-surface outline-none transition-all"
        />
      </div>

      {/* Decorative only — no name/onChange, never reaches form submission
          or gates the submit button. Mirrors the login page's pattern for
          an inert Stitch element with no backing feature (see
          app/(auth)/auth-form.tsx's "Remember me" checkbox). This app
          tracks no document-authenticity confirmation. */}
      <label className="group flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 cursor-pointer rounded border-2 border-outline-variant text-primary focus:ring-2 focus:ring-primary-container"
        />
        <span className="font-body-md text-body-md text-on-surface transition-colors group-hover:text-on-background">
          I confirm this document is authentic and valid.
        </span>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-fit items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden className="material-symbols-outlined text-[18px]">
          verified
        </span>
        {submitting ? "Uploading…" : "Upload certificate"}
      </button>

      {error && (
        <p role="alert" className="font-body-sm text-body-sm text-error">
          {error}
        </p>
      )}
      {lastUploaded && (
        <div className="flex items-center gap-2">
          {/* Icon lives outside the text node on purpose: an aria-hidden
              element is excluded from the accessibility tree but NOT from
              raw textContent, so nesting it inside the same <p> as
              "Uploaded ..." would prepend the "check_circle" ligature text
              and break the e2e suite's `/^Uploaded Insurance/` match. */}
          <span
            aria-hidden
            className="material-symbols-outlined text-[18px] text-primary-container"
          >
            check_circle
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Uploaded {lastUploaded.certificateType} —{" "}
            <span
              className={
                lastUploaded.status === "valid"
                  ? "font-label-md text-label-md text-primary-container"
                  : "font-label-md text-label-md text-error"
              }
            >
              {lastUploaded.status === "valid" ? "Valid" : "Expired"}
            </span>
            .
          </p>
        </div>
      )}
    </form>
  );
}
