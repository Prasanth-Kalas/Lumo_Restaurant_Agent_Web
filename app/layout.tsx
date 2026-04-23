/**
 * Minimal root layout. The Restaurant Agent has no user-facing UI —
 * it's a tool-surface service. Users talk to the shell; the shell talks
 * to us. The single HTML page we serve is the operator status page at `/`.
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumo Restaurant Agent",
  description:
    "Restaurant search, availability, and reservation booking. Service endpoint only.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
