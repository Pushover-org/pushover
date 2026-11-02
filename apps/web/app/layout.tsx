import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const instrument = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Rightful Share: bots filed half the claims. Here's your real share.", template: "%s · Rightful Share" },
  description:
    "A claims desk for class-action settlements. AI reads the evidence, deterministic rules decide, PayPal Payouts pays the honest claimant, and leftover money goes to the court's chosen charity.",
};

export const viewport: Viewport = { themeColor: "#f4f1e8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${instrument.variable}`}>
      <body>
        {/* Roughens rubber-stamp borders and text, like ink on paper. */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
          <filter id="ink">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="2.2" />
          </filter>
        </svg>
        {children}
      </body>
    </html>
  );
}
