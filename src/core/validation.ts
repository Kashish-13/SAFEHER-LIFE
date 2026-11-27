import { z } from "zod";
import { ROLES } from "./types";

/**
 * Request schemas shared by the API (server-side validation) and clients
 * (form validation). The server ALWAYS re-validates — client validation is UX only.
 */

/** Trims, collapses whitespace and strips control characters / angle brackets. */
const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F<>]/g, "").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max));

const requiredText = (max: number, label: string) =>
  cleanText(max).pipe(z.string().min(1, `${label} is required`));

/** E.164-ish phone: optional +, 8–15 digits. */
export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, "Enter a valid phone number with country code, e.g. +919876543210"));

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  capturedAt: z.string().datetime(),
  source: z.enum(["device_gps", "browser", "manual", "simulated"]),
});

export const profileUpdateSchema = z
  .object({
    fullName: requiredText(80, "Full name"),
    phone: phoneSchema.nullable(),
    language: z.enum(["en", "hi", "bn", "ta", "te", "mr", "kn", "ml", "gu", "pa"]),
    photoURL: z.string().url().max(2048).nullable(),
    onboardingComplete: z.boolean(),
  })
  .partial();

export const emergencyPreferencesSchema = z.object({
  confirmBeforeSOS: z.boolean(),
  cancelWindowSeconds: z.number().int().min(0).max(30),
  shareLocationOnSOS: z.boolean(),
  notifyCircleIds: z.array(z.string().max(64)).max(20),
  escalation: z.object({
    enabled: z.boolean(),
    primaryTimeoutSeconds: z.number().int().min(30).max(1800),
  }),
});

export const voiceSosSchema = z.object({
  enabled: z.boolean(),
  phrase: requiredText(40, "Emergency phrase").pipe(
    z.string().refine((p) => p.split(" ").length >= 2, "Use at least two words to reduce accidental triggers"),
  ),
  sensitivity: z.number().min(0).max(1),
  falseActivationWindowSeconds: z.number().int().min(3).max(30),
});

export const privacySchema = z.object({
  allowHelperRequests: z.boolean(),
  historyRetentionDays: z.number().int().min(0).max(3650),
});

export const contactCreateSchema = z
  .object({
    name: requiredText(80, "Name"),
    relationship: requiredText(40, "Relationship"),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(254).nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    priority: z.enum(["primary", "secondary"]),
    notifyOnEmergency: z.boolean().default(true),
  })
  .refine((c) => c.email || c.phone, { message: "Provide an email or phone number", path: ["email"] });

export const contactUpdateSchema = z
  .object({
    name: requiredText(80, "Name"),
    relationship: requiredText(40, "Relationship"),
    priority: z.enum(["primary", "secondary"]),
    notifyOnEmergency: z.boolean(),
    action: z.enum(["block", "unblock", "remove", "resend_invite", "approve_claim", "reject_claim"]),
  })
  .partial();

export const invitationResponseSchema = z.object({
  token: z.string().min(20).max(200),
  decision: z.enum(["accept", "reject"]),
});

export const circleSchema = z.object({
  name: requiredText(40, "Circle name"),
  description: cleanText(200).default(""),
  contactIds: z.array(z.string().max(64)).max(50),
});

export const emergencyCreateSchema = z.object({
  trigger: z.enum(["manual", "voice", "voice_simulated"]),
  location: geoPointSchema.nullable(),
  note: cleanText(500).nullable().optional(),
  circleIds: z.array(z.string().max(64)).max(20).optional(),
});

export const emergencyUpdateSchema = z.object({
  action: z.enum(["cancel", "resolve"]),
  note: cleanText(500).optional(),
});

export const emergencyRespondSchema = z.object({
  action: z.enum(["delivered", "acknowledge", "decline"]),
});

export const locationShareCreateSchema = z.object({
  contactId: z.string().min(1).max(64),
  mode: z.enum(["always", "temporary"]),
  /** Required for temporary shares. */
  durationMinutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
}).refine((v) => v.mode === "always" || (v.durationMinutes ?? 0) > 0, {
  message: "Choose a duration for temporary sharing",
  path: ["durationMinutes"],
});

export const locationShareUpdateSchema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
});

export const locationUpdateSchema = z.object({ location: geoPointSchema });

export const journeyCreateSchema = z.object({
  origin: requiredText(160, "Starting point"),
  destination: requiredText(160, "Destination"),
  expectedArrivalAt: z.string().datetime(),
  checkInIntervalMinutes: z.number().int().min(5).max(240),
  gracePeriodMinutes: z.number().int().min(2).max(60),
  autoEscalate: z.boolean(),
  contactIds: z.array(z.string().max(64)).min(1, "Select at least one trusted contact").max(20),
});

export const journeyUpdateSchema = z.object({
  action: z.enum(["check_in", "arrived", "cancel", "extend"]),
  extendMinutes: z.number().int().min(5).max(240).optional(),
});

export const roleUpdateSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1),
  disabled: z.boolean().optional(),
});

export const demoLoginSchema = z.object({ personaId: z.string().min(1).max(64) });

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type EmergencyCreateInput = z.infer<typeof emergencyCreateSchema>;
export type JourneyCreateInput = z.infer<typeof journeyCreateSchema>;
