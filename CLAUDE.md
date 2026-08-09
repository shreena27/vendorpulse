# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the dev server at http://localhost:3000 (hot reload).
- `npm run build` — production build.
- `npm start` — serve the production build (run `build` first).
- `npm run lint` — run ESLint (flat config, `eslint.config.mjs`).

No test runner is configured yet. `npm test` does not exist; add a framework (e.g. Vitest or Jest) before writing tests.

## Stack and versions

- **Next.js 16** with the **App Router** (`app/` directory). No `pages/` directory.
- **React 19** with React Server Components by default. Add `"use client"` at the top of a file only when it needs browser APIs, state, or effects.
- **Tailwind CSS v4** — configured entirely in CSS, not JS. There is **no `tailwind.config.js`**. Theme tokens, fonts, and colors live in `app/globals.css` under the `@theme inline { ... }` block, imported via `@import "tailwindcss"`. Add or change design tokens there.
- **TypeScript** in `strict` mode. Import alias `@/*` maps to the project root (see `tsconfig.json`), so `@/app/...` resolves from the repo root.

## Architecture notes

- `app/layout.tsx` is the root layout: it loads the Geist fonts, applies `globals.css`, and wraps all pages. Its signature uses `LayoutProps<"/">` — a **globally-available generated type** from Next.js 16's typed routes. These types (`LayoutProps`, `PageProps`, etc.) are generated into `.next/` during `dev`/`build`; if the editor cannot find them, run `npm run dev` or `npm run build` once to regenerate.
- `app/page.tsx` is the home route (`/`) and is currently the default scaffold page. Static assets live in `public/` and are referenced from the site root (e.g. `src="/next.svg"`).
- Dark mode is driven by `prefers-color-scheme` via the `dark:` Tailwind variant and the CSS custom properties in `globals.css`; there is no manual theme toggle.
