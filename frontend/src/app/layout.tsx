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

const TITLE = "Grid intelligence";
const DESCRIPTION =
  "Real-time intelligence over the US and European electricity grids - demand, generation mix, forecasting, anomalies, and data quality.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  // Match the browser UI (address bar) to the active theme.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0e" },
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
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
      <body>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
