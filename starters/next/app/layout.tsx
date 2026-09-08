import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { site } from "@/site";
import "./globals.css";

// Self-hosted with the rest of the build: no request to Google at runtime, no layout shift.
const display = Source_Serif_4({ subsets: ["latin"], variable: "--font-display-face", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
  openGraph: { title: site.name, description: site.description, url: "/", siteName: site.name, type: "website" },
  twitter: { card: "summary_large_image", title: site.name, description: site.description },
  alternates: { canonical: "/" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
