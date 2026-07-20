import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClientErrorBoundary } from "@/components/app-shell/client-error-boundary";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PPC Pilot | Amazon PPC 广告优化",
  description: "基于规则引擎并预留 AI Bid Optimization Engine 的 Amazon PPC 广告优化 SaaS。",
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
