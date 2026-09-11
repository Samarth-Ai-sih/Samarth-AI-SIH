import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/components/providers/query-provider";

export const metadata: Metadata = {
  title: "SAMARTH AI — MPLADS Risk Intelligence",
  description:
    "Detect Early. Verify on Ground. Deliver Public Assets on Time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AuthProvider><QueryProvider>{children}</QueryProvider></AuthProvider>
      </body>
    </html>
  );
}
