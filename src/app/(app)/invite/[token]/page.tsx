"use client";

import { Clock, HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PhoneVerify } from "@/components/auth/phone-verify";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";

interface Invitation { ownerName: string; relationship: string; priority: string; status: string }

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const toast = useToast();
  const { profile, mode } = useAuth();
  const { data, error, loading } = useApi<{ invitation: Invitation }>(`/api/invitations/${token}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  const verified = Boolean(profile?.emailVerified || profile?.phoneVerified);

  const respond = async (decision: "accept" | "reject") => {
    setBusy(decision);
    try {
      await api("/api/invitations/respond", { body: { token, decision } });
      if (decision === "accept") { setClaimed(true); setBusy(null); }
      else { toast("Invitation declined"); router.push("/dashboard"); }
    } catch (e) { toast((e as Error).message, "error"); setBusy(null); }
  };

  if (claimed && data) {
    const first = data.invitation.ownerName.split(" ")[0];
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Clock className="size-7" /></div>
          <h1 className="text-xl font-bold">Waiting for {first} to approve</h1>
          <p className="text-sm text-muted-foreground">
            To protect {first}, they need to confirm this account is really you. You&apos;ll be notified when they approve, and only then will
            you start receiving their alerts.
          </p>
          <Button asChild variant="outline" className="w-full"><Link href="/circle">View my circles</Link></Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) return <LoadingBlock rows={2} />;
  if (error) return <div className="mx-auto max-w-md space-y-4"><ErrorState message={error} /><Button asChild variant="outline"><Link href="/dashboard">Go to dashboard</Link></Button></div>;
  const inv = data!.invitation;

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-5 p-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent/10 text-accent"><HeartHandshake className="size-7" /></div>
        <div>
          <h1 className="text-xl font-bold">{inv.ownerName} wants you in their emergency circle</h1>
          <p className="mt-1 text-sm text-muted-foreground">As their {inv.relationship.toLowerCase()} and a <strong className="capitalize">{inv.priority}</strong> contact.</p>
        </div>
        <Alert tone="neutral" title="What happens next" className="text-left">
          <ol className="list-decimal space-y-1 pl-4">
            <li>{inv.ownerName.split(" ")[0]} will see your account&apos;s <strong>name, email and phone number</strong> so they can confirm it&apos;s really you.</li>
            <li>Once they approve, you&apos;ll receive their emergency alerts with the time and any location they choose to share.</li>
            <li>You can leave their circle at any time.</li>
          </ol>
        </Alert>
        {inv.status !== "pending" ? <Alert tone="warning">This invitation is no longer pending.</Alert> : !verified ? (
          <div className="space-y-3 text-left">
            <Alert tone="warning" title="Verify your identity first">
              So {inv.ownerName.split(" ")[0]} can trust this request, verify your phone number{mode === "firebase" ? " or your email address (check your inbox for the verification link)" : ""}.
            </Alert>
            <PhoneVerify />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" loading={busy === "reject"} onClick={() => respond("reject")}>Decline</Button>
            <Button variant="accent" loading={busy === "accept"} onClick={() => respond("accept")}>Accept</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
