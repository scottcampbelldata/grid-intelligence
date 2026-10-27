import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

// Type follows scottcampbell.io: Source Serif 4 for text, Libertinus Serif
// Display for headings, Plex Mono for figures. All self hosted from /fonts.

export const metadata: Metadata = {
  metadataBase: new URL("https://grid.scottcampbell.io"),
  title: "Grid Intelligence: US and Europe electricity demand dashboard",
  description:
    "Electricity grid dashboard for the US and Europe: demand, generation mix, demand forecast accuracy against EIA, anomaly detection and data quality.",
  applicationName: "Grid Intelligence",
  authors: [{ name: "Scott Campbell", url: "https://scottcampbell.io/" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Grid Intelligence",
    title: "Grid Intelligence: US and Europe electricity demand dashboard",
    description: "Electricity grid dashboard for the US and Europe: demand, generation mix, demand forecast accuracy against EIA, anomaly detection and data quality.",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Grid Intelligence dashboard showing US electricity demand" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Grid Intelligence: US and Europe electricity demand dashboard",
    description: "Electricity grid dashboard for the US and Europe: demand, generation mix, demand forecast accuracy against EIA, anomaly detection and data quality.",
    images: ["/og-image.png"],
  },
};

// Structured data for search engines.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "Grid Intelligence",
  "url": "https://grid.scottcampbell.io/",
  "description": "Electricity grid dashboard for the US and Europe: demand, generation mix, demand forecast accuracy against EIA, anomaly detection and data quality.",
  "applicationCategory": "ReferenceApplication",
  "operatingSystem": "Any (web browser)",
  "isAccessibleForFree": true,
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "author": {
    "@type": "Person",
    "name": "Scott Campbell",
    "url": "https://scottcampbell.io/"
  },
  "subjectOf": {
    "@type": "CreativeWork",
    "name": "Grid Intelligence case study",
    "url": "https://scottcampbell.io/projects/grid-intelligence/"
  },
  "sameAs": [
    "https://github.com/scottcampbelldata/grid-intelligence"
  ]
};

export const viewport: Viewport = {
  // Match the browser UI (address bar) to the active theme.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#13191b" },
    { media: "(prefers-color-scheme: light)", color: "#fdfdfc" },
  ],
  colorScheme: "light dark",
};

// Runs before first paint: apply the stored (or system) theme class to <html> so
// there's no flash of the wrong theme on load. Kept tiny and dependency-free;
// the ThemeProvider adopts the same choice once React mounts.
const NO_FLASH = `(function(){try{var m=localStorage.getItem('theme')||'system';var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=m==='dark'||(m==='system'&&d)?'dark':'light';var r=document.documentElement;r.classList.add(t);r.style.colorScheme=t;}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/source-serif-4-text.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/libertinus-serif-display-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
