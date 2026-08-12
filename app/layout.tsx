import type { Metadata } from "next";
import { Manrope, Inter } from "next/font/google";
import "./globals.css";

// Stitch design system: Manrope for headlines, Inter for body/labels
// (docs/superpowers/plans/2026-08-12-visual-polish-stitch-designs.md).
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "VendorPulse",
  description: "Continuous vendor trust monitoring.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        {/* Material Symbols Outlined — icon font used across every restyled page.
            This rule targets the Pages Router's _document.js; there is no such
            file in this App Router project, and the root layout's <head> is the
            correct place for a non-next/font stylesheet link. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
