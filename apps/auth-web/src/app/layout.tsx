import "@vortex/ui/globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Vortex Auth",
  description: "Vortex company single sign-on",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
