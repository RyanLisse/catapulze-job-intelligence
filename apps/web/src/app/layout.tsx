import type { Metadata } from "next";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

export const metadata: Metadata = {
  description:
    "Collect vacancies, search them with Boolean logic, and export after human approval.",
  title: "Catapulze Job Intelligence",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Header />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
