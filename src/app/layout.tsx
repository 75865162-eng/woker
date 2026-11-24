import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClientErrorBoundary } from "@/components/app-shell/client-error-boundary";
import "./globals.css";

const geistSans = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AOOCY",
    template: "%s | AOOCY",
  },
  description: "Thoughtful signs for everyday spaces. An independent brand dedicated to practical, well-made products.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ClientErrorBoundary>{children}</ClientErrorBoundary>
      </body>
    </html>
  );
}
