import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/server/env";
import { errorResponse } from "@/server/http";
import { applyRetention, runAllEscalations } from "@/server/services/emergencies";
import { processAllJourneys } from "@/server/services/journeys";

/**
 * Scheduled safety sweep: emergency escalations, journey check-ins and data retention.
 * Vercel Cron authenticates with `Authorization: Bearer $CRON_SECRET`.
 * Open client screens also trigger the same idempotent checks, so this is a backstop.
 */
export async function GET(req: NextRequest) {
  try {
    const expected = Buffer.from(`Bearer ${serverEnv.cronSecret}`);
    const given = Buffer.from(req.headers.get("authorization") ?? "");
    if (!serverEnv.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return NextResponse.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, { status: 401 });
    }
    const [escalations, journeys, retention] = await Promise.all([runAllEscalations(), processAllJourneys(), applyRetention()]);
    return NextResponse.json({ escalations, journeys, retention, at: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
