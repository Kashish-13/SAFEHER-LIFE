import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { EmulatorBanner } from "@/components/layout/emulator-banner";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/hooks/use-auth";
import { clientMode } from "@/lib/config";
import "./globals.css";

const isEmulator = clientMode.mode === "emulator";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  // Emulator builds are also marked in the browser tab, so a test window is never mistaken for a real one.
  title: isEmulator
    ? { default: "[Local emulator] SafeHer", template: "%s · SafeHer [Local emulator]" }
    : { default: "SafeHer — Your Safety. Your Circle. Your Protection.", template: "%s · SafeHer" },
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
        <EmulatorBanner />
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
