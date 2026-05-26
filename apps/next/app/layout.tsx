import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
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

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
