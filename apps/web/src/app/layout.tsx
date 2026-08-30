import type { Metadata } from "next";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  description:
    "Doorzoek opdrachten uit meerdere bronnen met snelle Boolean search en volledige herkomstinformatie.",
  title: "Catapulze Job Intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>
          <div className="grid min-h-dvh w-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
            <a
              href="#main-content"
              className="fixed top-2 left-2 z-[100] -translate-y-20 bg-[var(--ji-signal)] px-4 py-3 text-sm font-semibold text-[var(--ji-ink)] transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-white"
            >
              Naar hoofdinhoud
            </a>
            <Header />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
