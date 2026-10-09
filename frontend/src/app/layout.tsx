import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { QueryProvider } from "@/components/providers/query-provider";

export const metadata: Metadata = {
  title: "SAMARTH AI — MPLADS Risk Intelligence",
  description:
    "Detect Early. Verify on Ground. Deliver Public Assets on Time.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider><QueryProvider>{children}</QueryProvider></AuthProvider>
      </body>
    </html>
  );
}
