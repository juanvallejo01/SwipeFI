import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import WelcomeHeader from "@/components/telegram/WelcomeHeader";
import Providers from "./providers";
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
  title: "SwipeFi",
  description: "Zap USDC into stETH yield in one swipe.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-50">
        <Providers>
          <WelcomeHeader />
          <main className="flex flex-1 flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
