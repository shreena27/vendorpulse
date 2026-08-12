"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { AuthState } from "./actions";

type AuthFormProps = {
  title: string;
  submitLabel: string;
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  altPrompt: string;
  altHref: string;
  altLabel: string;
};

export function AuthForm({
  title,
  submitLabel,
  action,
  altPrompt,
  altHref,
  altLabel,
}: AuthFormProps) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    null,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-margin-x-mobile py-16">
      <div className="w-full max-w-md">
        <div className="ambient-shadow flex flex-col gap-stack-lg rounded-xl border border-surface-variant bg-surface-container-lowest p-stack-lg">
          {/* Logo mark */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary-container text-on-primary-container">
              <span className="material-symbols-outlined text-[20px]">
                shield_lock
              </span>
            </div>
            <span className="font-headline-md text-headline-md text-on-surface">
              VendorPulse
            </span>
          </div>

          <h1 className="font-headline-lg text-headline-lg text-on-surface">
            {title}
          </h1>

          <form
            action={formAction}
            className="flex flex-col gap-stack-md"
            noValidate
          >
            <div className="flex flex-col gap-base">
              <label
                htmlFor="email"
                className="font-label-md text-label-md text-on-surface"
              >
                Email
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-outline">
                  <span className="material-symbols-outlined text-[20px]">
                    mail
                  </span>
                </div>
                <input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  required
                  className="focus-glow w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-10 pr-4 font-body-md text-body-md text-on-surface placeholder-outline transition-all outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col gap-base">
              <label
                htmlFor="password"
                className="font-label-md text-label-md text-on-surface"
              >
                Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-outline">
                  <span className="material-symbols-outlined text-[20px]">
                    lock
                  </span>
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  className="focus-glow w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pr-10 pl-10 font-body-md text-body-md text-on-surface placeholder-outline transition-all outline-none"
                />
                <button
                  type="button"
                  aria-label="Toggle visibility"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-outline transition-colors hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    {showPassword ? "visibility" : "visibility_off"}
                  </span>
                </button>
              </div>
            </div>

            {/* Decorative only — no name/onChange, never reaches form submission.
                No "remember me" or password-reset feature exists yet. */}
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="remember-me"
                  className="h-4 w-4 cursor-pointer rounded border-outline-variant bg-surface-container-lowest text-primary focus:ring-primary-container"
                />
                <label
                  htmlFor="remember-me"
                  className="ml-2 block cursor-pointer font-body-sm text-body-sm text-on-surface-variant"
                >
                  Remember me for 30 days
                </label>
              </div>
              <span className="font-label-md text-label-md text-primary-container">
                Forgot password?
              </span>
            </div>

            {state?.error ? (
              <p
                role="alert"
                className="rounded-lg bg-error-container px-3 py-2 text-body-sm font-body-sm text-on-error-container"
              >
                {state.error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="mt-stack-sm flex w-full items-center justify-center rounded-lg border border-transparent bg-primary px-4 py-2.5 font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary/90 focus:ring-2 focus:ring-primary focus:outline-none active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? "Please wait…" : submitLabel}
            </button>
          </form>

          <p className="mt-stack-sm border-t border-surface-variant pt-stack-md text-center font-body-sm text-body-sm text-on-surface-variant">
            {altPrompt}{" "}
            <Link
              href={altHref}
              className="ml-1 font-label-md text-label-md text-primary-container transition-colors hover:text-primary"
            >
              {altLabel}
            </Link>
          </p>
        </div>

        <div className="mt-stack-lg flex items-center justify-center gap-2 text-body-sm font-body-sm text-outline opacity-80">
          <span className="material-symbols-outlined text-[16px]">
            encrypted
          </span>
          <span>Enterprise-grade security</span>
        </div>
      </div>
    </div>
  );
}
