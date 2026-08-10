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
      className="flex flex-col gap-3 rounded-md border border-black/[.08] p-4 dark:border-white/[.12]"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="cert-file" className="text-sm font-medium text-black dark:text-zinc-50">
          File
        </label>
        <input
          id="cert-file"
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          required
          className="block text-sm text-zinc-700 file:mr-4 file:rounded-full file:border file:border-black/[.12] file:bg-transparent file:px-4 file:py-1.5 file:text-sm file:font-medium hover:file:bg-black/[.04] dark:text-zinc-300 dark:file:border-white/[.16] dark:hover:file:bg-white/[.06]"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="cert-type" className="text-sm font-medium text-black dark:text-zinc-50">
          Certificate type
        </label>
        <input
          id="cert-type"
          name="certificateType"
          type="text"
          required
          list="certificate-type-suggestions"
          placeholder="e.g. Insurance"
          className="rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.16]"
        />
        <datalist id="certificate-type-suggestions">
          {CERTIFICATE_TYPE_SUGGESTIONS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="cert-expiry" className="text-sm font-medium text-black dark:text-zinc-50">
          Expiry date
        </label>
        <input
          id="cert-expiry"
          name="expiryDate"
          type="date"
          required
          className="rounded-md border border-black/[.12] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.16]"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/80"
      >
        {submitting ? "Uploading…" : "Upload certificate"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {lastUploaded && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Uploaded {lastUploaded.certificateType} —{" "}
          <span className={lastUploaded.status === "valid" ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
            {lastUploaded.status === "valid" ? "Valid" : "Expired"}
          </span>
          .
        </p>
      )}
    </form>
  );
}
