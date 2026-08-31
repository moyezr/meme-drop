import type { Metadata, Viewport } from "next";
import { Mouse_Memoirs, TikTok_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import "./landing.css";

const siteUrl = "https://memedrop.moyezrabbani.dev";
const title = "MemeDrop — The humor layer for AI agents";
const description =
  "Give your AI agent a sense of humor. MemeDrop turns text context into captioned meme images through one HTTPS API. Available in private beta.";

const mouseMemoirs = Mouse_Memoirs({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-google-display",
  display: "swap",
});

const tikTokSans = TikTok_Sans({
  subsets: ["latin"],
  variable: "--font-google-body",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s | MemeDrop",
  },
  description,
  applicationName: "MemeDrop",
  authors: [{ name: "Moyez Rabbani", url: "https://moyezrabbani.dev" }],
  creator: "Moyez Rabbani",
  publisher: "MemeDrop",
  alternates: {
    canonical: "/",
  },
  keywords: [
    "MemeDrop",
    "AI agents",
    "meme generation API",
    "humor layer",
    "meme generator",
    "AI meme captions",
  ],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "MemeDrop",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    creator: "@MoyezRabbani",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0B0F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${mouseMemoirs.variable} ${tikTokSans.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
