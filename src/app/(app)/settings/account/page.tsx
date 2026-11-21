"use client";

import { LogOut, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";

export default function AccountSettingsPage() {
  const { profile, mode, signOut, email } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Account" />
      <Card>
        <CardHeader><CardTitle>Account details</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Email:</span> {email ?? profile!.email}</p>
          <p><span className="text-muted-foreground">Sign-in method:</span> {mode === "demo" ? "Demo persona (simulated)" : "Firebase Authentication"}</p>
          <p><span className="text-muted-foreground">Roles:</span> {profile!.roles.map((r) => <Badge key={r} className="mr-1 capitalize">{r.replace("_", " ")}</Badge>)}</p>
          <p><span className="text-muted-foreground">Member since:</span> {formatDateTime(profile!.createdAt)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Session</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={async () => { await signOut(); router.push("/login"); }}><LogOut />Sign out of this device</Button>
        </CardContent>
      </Card>

      <Card className="border-emergency/30">
        <CardHeader><CardTitle className="text-emergency">Delete account</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently deletes your profile, trusted contacts, circles, emergency history, location shares, journeys and notifications.
            People who listed you as their trusted contact will see that the link ended. This cannot be undone.
          </p>
          <Button variant="emergency" onClick={() => setOpen(true)}><Trash2 />Delete my account</Button>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="Delete your SafeHer account?" description="Type DELETE to confirm.">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setError(null);
          try {
            await api("/api/me", { method: "DELETE", body: { confirm: confirmText } });
            toast("Your account and data were deleted");
            await signOut();
            router.push("/");
          } catch (err) { setError((err as Error).message); setBusy(false); }
        }}>
          <Field id="del" label="Confirmation"><Input id="del" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" /></Field>
          {error && <Alert tone="emergency">{error}</Alert>}
          <Button type="submit" variant="emergency" className="w-full" disabled={confirmText !== "DELETE"} loading={busy}>Permanently delete</Button>
        </form>
      </Dialog>
    </div>
  );
}
