"use client";

import { ChevronRight, Lock, Mic, Settings, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { UserProfile } from "@/core/types";
import { PhoneVerify } from "@/components/auth/phone-verify";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/utils";

const LANGUAGES = [["en", "English"], ["hi", "हिन्दी"], ["bn", "বাংলা"], ["ta", "தமிழ்"], ["te", "తెలుగు"], ["mr", "मराठी"], ["kn", "ಕನ್ನಡ"], ["ml", "മലയാളം"], ["gu", "ગુજરાતી"], ["pa", "ਪੰਜਾਬੀ"]];

export default function ProfilePage() {
  const { profile, setProfile } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState(profile!.fullName);
  const [language, setLanguage] = useState(profile!.language);
  const [busy, setBusy] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Profile" />
      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <span className="grid size-16 place-items-center rounded-full bg-primary text-xl font-bold text-white">{initials(profile!.fullName)}</span>
          <div>
            <p className="text-lg font-semibold">{profile!.fullName}</p>
            <p className="text-sm text-muted-foreground">{profile!.email}</p>
            <div className="mt-1 flex gap-1">{profile!.roles.map((r) => <Badge key={r} className="capitalize">{r.replace("_", " ")}</Badge>)}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Personal details</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try { const r = await api<{ profile: UserProfile }>("/api/me", { method: "PATCH", body: { fullName, language } }); setProfile(r.profile); toast("Profile updated"); }
            catch (err) { toast((err as Error).message, "error"); } finally { setBusy(false); }
          }}>
            <Field id="name" label="Full name"><Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} required /></Field>
            <Field id="lang" label="Preferred language"><Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Button type="submit" loading={busy}>Save</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Phone number</CardTitle>
          {profile!.phoneVerified && !changingPhone && <Button variant="ghost" size="sm" onClick={() => setChangingPhone(true)}>Change</Button>}
        </CardHeader>
        <CardContent>
          {changingPhone || !profile!.phoneVerified
            ? <PhoneVerify key={String(changingPhone)} onVerified={() => setChangingPhone(false)} />
            : <p className="text-sm"><strong>{profile!.phone}</strong> <Badge tone="success">Verified</Badge></p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y p-2">
          {[
            { href: "/settings/sos", icon: ShieldAlert, t: "SOS settings" },
            { href: "/settings/voice", icon: Mic, t: "Voice SOS" },
            { href: "/settings/privacy", icon: Lock, t: "Privacy" },
            { href: "/settings/account", icon: Settings, t: "Account & deletion" },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-xl px-3 py-3.5 hover:bg-secondary/60">
              <l.icon className="size-4 text-accent" /><span className="flex-1 text-sm font-medium">{l.t}</span><ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
