import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/hooks/use-auth";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "SafeHer — Your Safety. Your Circle. Your Protection.", template: "%s · SafeHer" },
  description:
    "SafeHer is a personal safety and emergency response platform: one SOS alerts your trusted circle simultaneously, shares your location with consent, and guides your journeys home.",
  applicationName: "SafeHer",
};

export const viewport: Viewport = {
  themeColor: "#13123A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen font-sans">
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
