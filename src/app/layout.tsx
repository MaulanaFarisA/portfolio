import type { Metadata } from "next";
import { Inter, JetBrains_Mono, VT323 } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "optional",
  variable: "--font-inter",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "optional",
  variable: "--font-jetbrains",
});

const vt323 = VT323({
  subsets: ["latin"],
  weight: "400",
  display: "optional",
  variable: "--font-vt323",
});

export const metadata: Metadata = {
  title: "Maulana Faris",
  description: "Computer Science student at UGM, building web products end-to-end.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon-180.png", sizes: "180x180" },
    ],
  },
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');
if(!t)t='dark';
document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrains.variable} ${vt323.variable}`}
    >
      <head>
        {/*
          Manual font preloads (workaround): Next.js does not emit <link rel="preload">
          for next/font on this toolchain (next-font-manifest.json is empty — vercel/next.js
          #57008 / #62332). These are the latin `.p.woff2` faces for Inter, JetBrains Mono and
          VT323. Filenames are CONTENT-HASHED: re-verify after any font config change (see
          design.md §3.3 revision 2026-10-01). Only meaningful with display:"optional", so the
          already-downloaded face is used without a post-paint swap.
        */}
        <link rel="preload" as="font" type="font/woff2" crossOrigin="anonymous" href="/_next/static/media/e4af272ccee01ff0-s.p.woff2" />
        <link rel="preload" as="font" type="font/woff2" crossOrigin="anonymous" href="/_next/static/media/558ca1a6aa3cb55e-s.p.woff2" />
        <link rel="preload" as="font" type="font/woff2" crossOrigin="anonymous" href="/_next/static/media/b7bd7951037de757-s.p.woff2" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SiteNav />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
