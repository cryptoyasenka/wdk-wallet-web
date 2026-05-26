import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "WDK Web Wallet",
  description:
    "Reference self-custodial multi-chain web wallet built on the Tether Wallet Development Kit: create or import, passkey or passphrase unlock, portfolio, receive, send with itemised confirmation, and activity.",
  robots: { index: false, follow: false },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WDK Wallet",
  },
  icons: [
    { url: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
    { url: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
  ],
};

export const viewport: Viewport = {
  themeColor: "#060913",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  // Opt into per-request (dynamic) rendering. The strict CSP in middleware.ts
  // mints a fresh per-request nonce; a statically prerendered page would have
  // its inline RSC-bootstrap scripts baked at build time without that nonce and
  // they would be CSP-blocked. Reading a request header forces Next to render
  // per request, so it stamps those inline scripts with the live nonce.
  await headers();

  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
