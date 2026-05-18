import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WDK Web Wallet",
  description:
    "Reference self-custodial multi-chain web wallet built on the Tether Wallet Development Kit: create or import, passkey or passphrase unlock, portfolio, receive, send with itemised confirmation, and activity.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0f17",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
