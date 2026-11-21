import {
  Bell, Car, History, Home, LayoutDashboard, Lock, MapPin, Mic, Phone, Settings, ShieldAlert, Siren, Smartphone, User, Users, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon }
export interface NavGroup { label: string; items: NavItem[]; adminOnly?: boolean }

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Safety",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Home },
      { href: "/circle", label: "Emergency circle", icon: Users },
      { href: "/location", label: "Family location", icon: MapPin },
      { href: "/journey", label: "Safe Journey", icon: Car },
      { href: "/emergency-services", label: "Emergency services", icon: Phone },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/settings/sos", label: "SOS settings", icon: ShieldAlert },
      { href: "/settings/voice", label: "Voice SOS", icon: Mic },
      { href: "/fake-call", label: "Fake call", icon: Smartphone },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/history", label: "Emergency history", icon: History },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/profile", label: "Profile", icon: User },
      { href: "/settings/privacy", label: "Privacy", icon: Lock },
      { href: "/settings/account", label: "Account", icon: Settings },
    ],
  },
  { label: "Administration", adminOnly: true, items: [{ href: "/admin", label: "Admin console", icon: LayoutDashboard }] },
];

export const BOTTOM_NAV: (NavItem & { sos?: boolean })[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/location", label: "Location", icon: MapPin },
  { href: "/sos", label: "SOS", icon: Siren, sos: true },
  { href: "/circle", label: "Circle", icon: Users },
  { href: "/profile", label: "Profile", icon: User },
];
