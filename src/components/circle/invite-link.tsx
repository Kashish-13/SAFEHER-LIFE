"use client";

import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

/**
 * Shows a one-time invitation link. Email/SMS delivery isn't configured,
 * so the user shares the link themselves. The UI says so plainly.
 */
export function InviteLink({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const text = `I've added you as a trusted emergency contact on SafeHer. Please accept so you can receive my alerts: ${link}`;
  return (
    <div className="space-y-3">
      <Alert tone="success" title={`Invitation created for ${name}`}>
        Share this link with them. It works once and expires in 7 days. For your security, it won&apos;t be shown again (you can generate a new one with Resend).
      </Alert>
      <div className="flex items-center gap-2 rounded-xl border bg-muted/50 p-2 pl-3">
        <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
        <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="outline"><a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a></Button>
        <Button variant="outline" onClick={() => (navigator.share ? navigator.share({ title: "SafeHer invitation", text, url: link }).catch(() => {}) : navigator.clipboard.writeText(text))}>
          <Share2 /> Share…
        </Button>
      </div>
    </div>
  );
}
