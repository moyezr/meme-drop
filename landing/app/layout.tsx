import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://memedrop.moyezrabani.dev";
const title = "MemeDrop - Context-aware meme replies for X";
const description =
  "MemeDrop is a Chrome extension that ranks your meme library, prepares captions, and lets you drop the right meme into X replies.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s | MemeDrop",
  },
  description,
  applicationName: "MemeDrop",
  authors: [{ name: "Moyez Rabani", url: "https://moyezrabani.dev" }],
  creator: "Moyez Rabani",
  publisher: "MemeDrop",
  alternates: {
    canonical: "/",
  },
  keywords: [
    "MemeDrop",
    "Chrome extension",
    "X replies",
    "Twitter memes",
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
    creator: "@moyezrabani",
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
  themeColor: "#f4eadc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "MemeDrop",
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome",
    description,
    url: siteUrl,
    author: {
      "@type": "Person",
      name: "Moyez Rabani",
      url: "https://moyezrabani.dev",
    },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
