"use client";

import { useActionState } from "react";
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

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {title}
        </h1>

        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              className="rounded-md border border-black/[.12] bg-white px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.16] dark:bg-black dark:text-zinc-50"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Password
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              className="rounded-md border border-black/[.12] bg-white px-3 py-2 text-black outline-none focus:border-black/40 dark:border-white/[.16] dark:bg-black dark:text-zinc-50"
            />
          </label>

          {state?.error ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400"
            >
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="mt-2 flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {pending ? "Please wait…" : submitLabel}
          </button>
        </form>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          {altPrompt}{" "}
          <Link
            href={altHref}
            className="font-medium text-zinc-950 underline dark:text-zinc-50"
          >
            {altLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}
