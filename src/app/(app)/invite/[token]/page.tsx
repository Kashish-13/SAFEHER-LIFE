"use client";

import { HeartHandshake } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api-client";

interface Invitation { ownerName: string; relationship: string; priority: string; status: string }

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading } = useApi<{ invitation: Invitation }>(`/api/invitations/${token}`);
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (decision: "accept" | "reject") => {
    setBusy(decision);
    try {
      await api("/api/invitations/respond", { body: { token, decision } });
      toast(decision === "accept" ? "You're now a trusted contact" : "Invitation declined");
      router.push(decision === "accept" ? "/circle" : "/dashboard");
    } catch (e) { toast((e as Error).message, "error"); setBusy(null); }
  };

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
        <Alert tone="neutral" title="What this means" className="text-left">
          If {inv.ownerName.split(" ")[0]} triggers SOS, you&apos;ll get an alert with the time and the location they chose to share, and you can
          acknowledge it. They may also choose to share their live location with you. You can leave their circle at any time.
        </Alert>
        {inv.status !== "pending" ? <Alert tone="warning">This invitation is no longer pending.</Alert> : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" loading={busy === "reject"} onClick={() => respond("reject")}>Decline</Button>
            <Button variant="accent" loading={busy === "accept"} onClick={() => respond("accept")}>Accept</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
