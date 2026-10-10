import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

// Two families, two weights each - text in Inter, numerals in a mono for the
// terminal feel. next/font self-hosts these at build time (export-safe).
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

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
    { media: "(prefers-color-scheme: dark)", color: "#0d141c" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7f9" },
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
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
