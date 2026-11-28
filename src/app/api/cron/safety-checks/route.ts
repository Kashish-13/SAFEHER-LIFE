import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { assertServerConfigured, serverEnv } from "@/server/env";
import { errorResponse } from "@/server/http";
import { applyAccessExpiry, applyRetention, runAllEscalations } from "@/server/services/emergencies";
import { processAllJourneys } from "@/server/services/journeys";
import { resumePendingDeletions } from "@/server/services/users";

/**
 * Scheduled safety sweep: escalations, journey check-ins, retention, and the
 * 24 h contact-access expiry. Authenticated with `Authorization: Bearer $CRON_SECRET`.
 * On Vercel Hobby this runs only once a day, so it is a BACKSTOP, not the primary
 * escalation trigger (that's the open emergency screen today, a server scheduler in Phase 2).
 */
export async function GET(req: NextRequest) {
  try {
    const expected = Buffer.from(`Bearer ${serverEnv.cronSecret}`);
    const given = Buffer.from(req.headers.get("authorization") ?? "");
    if (!serverEnv.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return NextResponse.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, { status: 401 });
    }
    assertServerConfigured();
    const [escalations, journeys, retention, accessExpiry, deletions] = await Promise.all([
      runAllEscalations(), processAllJourneys(), applyRetention(), applyAccessExpiry(), resumePendingDeletions(),
    ]);
    return NextResponse.json({ escalations, journeys, retention, accessExpiry, deletions, at: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
