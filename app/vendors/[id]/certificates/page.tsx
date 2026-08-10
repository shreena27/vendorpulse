import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listVendorCertificatesWithUrls } from "@/lib/certificates/queries";
import { StatusBadge } from "../../StatusBadge";
import type { Badge } from "@/lib/vendors/statusBadge";
import { CertificateUploadForm } from "./CertificateUploadForm";

/** Deterministic UTC date, e.g. "2026-08-10". */
function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function certificateBadge(status: "valid" | "expired"): Badge {
  return status === "valid"
    ? { label: "Valid", tone: "green" }
    : { label: "Expired", tone: "red" };
}

export default async function VendorCertificatesPage(
  props: PageProps<"/vendors/[id]/certificates">,
) {
  const { id } = await props.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS-scoped: a vendor in another org reads as not found, same as the
  // vendor detail page.
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!vendor) notFound();

  const certificates = await listVendorCertificatesWithUrls(supabase, vendor.id);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/[.08] px-6 py-4 dark:border-white/[.12]">
        <span className="text-lg font-semibold tracking-tight text-black dark:text-zinc-50">
          VendorPulse
        </span>
        <Link
          href={`/vendors/${vendor.id}`}
          className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          ← {vendor.name}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
        <section className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Certificates — {vendor.name}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Insurance and safety documents, uploaded once at onboarding. Status
            reflects the expiry date at upload time only — there is no ongoing
            recheck.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Upload a certificate
          </h2>
          <CertificateUploadForm vendorId={vendor.id} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Uploaded certificates
          </h2>

          {certificates.length === 0 ? (
            <div className="rounded-md border border-dashed border-black/[.15] p-4 text-sm text-zinc-500 dark:border-white/[.18] dark:text-zinc-400">
              No certificates uploaded yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {certificates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/[.08] px-4 py-2 text-sm dark:border-white/[.12]"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-black dark:text-zinc-50">
                      {c.certificateType}
                    </span>
                    <StatusBadge badge={certificateBadge(c.status)} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span>Expires {fmtDate(c.expiryDate)}</span>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-black underline underline-offset-4 dark:text-zinc-50"
                      >
                        View
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
