"use client";

import { LogOut, MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { friendlyAuthError, useAuth } from "@/hooks/use-auth";
import { ApiClientError, api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";

export default function AccountSettingsPage() {
  const { profile, mode, signOut, signOutEverywhere, reauthenticate, reauthMethod, email } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"reauth" | "confirm">("reauth");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openDelete = () => { setStep("reauth"); setPassword(""); setConfirmText(""); setError(null); setOpen(true); };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Account" />
      <Card>
        <CardHeader><CardTitle>Account details</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Email:</span> {email ?? profile!.email} {profile!.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">not verified</Badge>}</p>
          <p><span className="text-muted-foreground">Sign-in method:</span> {mode === "demo" ? "Demo persona (simulated)" : reauthMethod === "password" ? "Email & password" : "Google"}</p>
          <p><span className="text-muted-foreground">Roles:</span> {profile!.roles.map((r) => <Badge key={r} className="mr-1 capitalize">{r.replace("_", " ")}</Badge>)}</p>
          <p><span className="text-muted-foreground">Member since:</span> {formatDateTime(profile!.createdAt)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Lost a phone, or signed in on a shared computer? Signing out everywhere ends every session on every device, including this one.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => signOut({ redirectTo: "/login" })}><LogOut />Sign out of this device</Button>
            <Button variant="outline" loading={busy === "everywhere"} onClick={async () => {
              if (!confirm("Sign out of SafeHer on ALL devices? You'll need to sign in again everywhere.")) return;
              setBusy("everywhere");
              try { await signOutEverywhere(); toast("Signed out on all devices"); }
              catch (e) { toast((e as Error).message, "error"); setBusy(null); }
            }}><MonitorSmartphone />Sign out everywhere</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-emergency/30">
        <CardHeader><CardTitle className="text-emergency">Delete account</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently deletes your profile, trusted contacts, circles, emergency history, location shares, journeys and notifications.
            People who listed you as their trusted contact will see that the link ended, and you&apos;ll lose access to their emergencies. This cannot be undone.
          </p>
          <Button variant="emergency" onClick={openDelete}><Trash2 />Delete my account</Button>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Delete your SafeHer account?"
        description={step === "reauth" ? "For your security, confirm it's you first." : "Type DELETE to confirm. This cannot be undone."}>
        {step === "reauth" ? (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setBusy("reauth"); setError(null);
            try { await reauthenticate(password); setStep("confirm"); }
            catch (err) { setError(friendlyAuthError(err)); }
            finally { setBusy(null); }
          }}>
            {reauthMethod === "password" ? (
              <Field id="pw" label="Your password"><Input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            ) : (
              <p className="text-sm text-muted-foreground">{mode === "demo" ? "Demo mode: this re-issues your persona session." : "You'll be asked to sign in with Google again."}</p>
            )}
            {error && <Alert tone="emergency">{error}</Alert>}
            <Button type="submit" className="w-full" loading={busy === "reauth"}><ShieldCheck />Confirm it&apos;s me</Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            setBusy("delete"); setError(null);
            try {
              await api("/api/me", { method: "DELETE", body: { confirm: confirmText } });
              toast("Your account and data were deleted");
              await signOut({ redirectTo: "/" });
            } catch (err) {
              if (err instanceof ApiClientError && err.code === "reauth_required") setStep("reauth");
              setError((err as Error).message);
              setBusy(null);
            }
          }}>
            <Alert tone="success">Identity confirmed. You have 5 minutes to complete deletion.</Alert>
            <Field id="del" label="Confirmation"><Input id="del" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" /></Field>
            {error && <Alert tone="emergency">{error}</Alert>}
            <Button type="submit" variant="emergency" className="w-full" disabled={confirmText !== "DELETE"} loading={busy === "delete"}>Permanently delete</Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
