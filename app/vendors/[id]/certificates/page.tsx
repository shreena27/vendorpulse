import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listVendorCertificatesWithUrls } from "@/lib/certificates/queries";
import { StatusBadge } from "../../StatusBadge";
import type { Badge } from "@/lib/vendors/statusBadge";
import { CertificateUploadForm } from "./CertificateUploadForm";
import { AppNav } from "@/app/components/AppNav";

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
    <div className="flex min-h-screen flex-col bg-background">
      <AppNav />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-stack-lg px-margin-x-mobile py-stack-lg md:px-margin-x-desktop">
        <div className="flex flex-col gap-stack-md md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <Link
              href={`/vendors/${vendor.id}`}
              className="flex w-fit items-center gap-1 font-label-md text-label-md text-secondary transition-colors hover:text-primary"
            >
              ← {vendor.name}
            </Link>
            <h1 className="font-headline-xl text-headline-lg-mobile text-on-background md:text-headline-xl">
              Certificates — {vendor.name}
            </h1>
            <p className="max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
              Insurance and safety documents, uploaded once at onboarding.
              Status reflects the expiry date at upload time only — there is
              no ongoing recheck.
            </p>
          </div>
        </div>

        <section className="flex flex-col gap-stack-md">
          <h2 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
            Upload a certificate
          </h2>
          <CertificateUploadForm vendorId={vendor.id} />
        </section>

        <section className="flex flex-col gap-stack-md">
          <h2 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
            Uploaded certificates
          </h2>

          {certificates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-gutter font-body-md text-body-md text-on-surface-variant">
              No certificates uploaded yet.
            </div>
          ) : (
            <ul className="ambient-shadow card-border flex flex-col divide-y divide-surface-container overflow-hidden rounded-xl bg-surface-container-lowest">
              {certificates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-stack-sm px-gutter py-stack-md transition-colors hover:bg-surface-container-low/30"
                >
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="material-symbols-outlined text-primary-container"
                    >
                      description
                    </span>
                    <span className="font-label-md text-label-md text-on-surface">
                      {c.certificateType}
                    </span>
                    <StatusBadge badge={certificateBadge(c.status)} />
                  </div>
                  <div className="flex items-center gap-4 font-body-sm text-body-sm text-secondary">
                    <span>Expires {fmtDate(c.expiryDate)}</span>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-label-md text-label-md text-primary-container underline underline-offset-4 hover:text-primary"
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
