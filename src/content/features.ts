import { Car, Eye, FileLock2, HandHeart, Headphones, MapPin, Mic, PhoneCall, ShieldAlert, Siren, Smartphone, Users, type LucideIcon } from "lucide-react";

/**
 * Honest availability labels. "web" = working in this web app today;
 * "next" = backend designed, UI in a following phase; "mobile" = requires the native app.
 */
export type Availability = "web" | "next" | "mobile";

export interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  availability: Availability;
}

export const FEATURES: Feature[] = [
  { icon: Siren, title: "One-tap SOS", body: "A large, unmistakable SOS button with a short cancel window. One trigger alerts your whole circle at the same time.", availability: "web" },
  { icon: Users, title: "Trusted Emergency Circle", body: "Invite family and friends, set primary and secondary contacts, organise circles, and see who has accepted.", availability: "web" },
  { icon: ShieldAlert, title: "Smart escalation", body: "If no primary contact acknowledges in time, secondary contacts are alerted automatically, exactly once.", availability: "web" },
  { icon: Eye, title: "Honest delivery tracking", body: "See sent, delivered, acknowledged, declined and failed per contact. Never shown before the system confirms it.", availability: "web" },
  { icon: MapPin, title: "Family location sharing", body: "Choose exactly who sees your location: always, for a set time, paused or stopped. Revoke at any moment.", availability: "web" },
  { icon: Car, title: "Safe Journey Guardian", body: "Share your trip, check in along the way. Missed check-ins remind you first, then escalate only if you opted in.", availability: "web" },
  { icon: Mic, title: "Voice-activated SOS", body: "Say your personal phrase to trigger SOS. Configure and test it here; locked-screen detection requires the native Android app.", availability: "mobile" },
  { icon: PhoneCall, title: "Emergency services", body: "One tap to dial 112 and India's women's helplines, plus nearby hospitals and police stations on the map.", availability: "web" },
  { icon: Smartphone, title: "Fake call", body: "Schedule a realistic simulated incoming call to excuse yourself from an uncomfortable situation.", availability: "web" },
  { icon: HandHeart, title: "Verified helper network", body: "Request help from nearby, opted-in, identity-verified community members, who only ever see your approximate distance.", availability: "next" },
  { icon: Headphones, title: "Group voice room", body: "Bring everyone who responds into one in-app voice room to coordinate, with no chain of phone calls.", availability: "next" },
  { icon: FileLock2, title: "Secure evidence vault", body: "User-initiated recordings, photos and notes, stored privately with timestamps and access control.", availability: "next" },
];

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  web: "Available",
  next: "Coming next",
  mobile: "Native app",
};
