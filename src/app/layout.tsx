import type { Metadata } from "next";
import { Geist, Geist_Mono, Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/i18n/i18n-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Cirkle Identity Verification — Egyptian & Arabic KYC",
  description:
    "Cirkle (دواير) — AI-powered live identity verification: read Egyptian and Arabic documents, capture a live selfie, and prove liveness with movement challenges. Zero-cost, self-hosted.",
  keywords: ["Cirkle", "دواير", "identity verification", "KYC", "Egyptian ID", "Arabic OCR", "liveness", "face match", "VLM"],
  authors: [{ name: "Cirkle" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Cirkle Identity Verification",
    description: "Cirkle (دواير) — Read Egyptian/Arabic documents, match faces, and verify liveness. Zero-cost, self-hosted.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} antialiased bg-background text-foreground`}
      >
        <I18nProvider>
          {children}
        </I18nProvider>
        <Toaster />
        <SonnerToaster richColors position="top-center" />
      </body>
    </html>
  );
}
