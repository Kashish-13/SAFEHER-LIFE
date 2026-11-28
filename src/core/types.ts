/**
 * SafeHer domain model.
 *
 * This module is framework-agnostic (no React, no Next.js, no Firebase) so it
 * can be shared verbatim with the future React Native app. All timestamps are
 * ISO-8601 strings in UTC so they serialise identically over REST and Firestore.
 */

export type ISODate = string;

export const ROLES = ["user", "trusted_contact", "helper", "admin"] as const;
export type Role = (typeof ROLES)[number];

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Accuracy radius in metres as reported by the device, if known. */
  accuracy?: number | null;
  capturedAt: ISODate;
  source: "device_gps" | "browser" | "manual" | "simulated";
}

export interface EscalationConfig {
  enabled: boolean;
  /** Seconds to wait for a primary-contact acknowledgement before notifying secondary contacts. */
  primaryTimeoutSeconds: number;
}

export interface EmergencyPreferences {
  /** Require a confirmation tap after pressing SOS. */
  confirmBeforeSOS: boolean;
  /** Countdown (seconds) during which a just-pressed SOS can be cancelled before alerts go out. 0 = send immediately. */
  cancelWindowSeconds: number;
  /** Attach the latest authorised location to emergency alerts. */
  shareLocationOnSOS: boolean;
  /** Circles to notify. Empty = all accepted contacts. */
  notifyCircleIds: string[];
  escalation: EscalationConfig;
}

export interface VoiceSosSettings {
  enabled: boolean;
  phrase: string;
  /** 0..1 — only honoured by native keyword-spotting engines that support it. */
  sensitivity: number;
  /** Seconds to allow cancelling a voice-triggered SOS (false-activation guard). */
  falseActivationWindowSeconds: number;
}

export interface PrivacySettings {
  /** Allow verified helpers within range to receive (approximate) location on request. */
  allowHelperRequests: boolean;
  /** Retention for emergency history in days (0 = keep until deleted). */
  historyRetentionDays: number;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  /** Mirrors the identity provider's verified-email flag (Firebase `email_verified`). */
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  photoURL: string | null;
  language: string;
  roles: Role[];
  onboardingComplete: boolean;
  emergencyPreferences: EmergencyPreferences;
  voiceSos: VoiceSosSettings;
  privacy: PrivacySettings;
  /** Firebase Cloud Messaging registration tokens for this user's devices. */
  fcmTokens: string[];
  /** Incremented by "sign out everywhere"; demo session tokens carry it and are rejected once stale. */
  tokenVersion: number;
  disabled: boolean;
  /**
   * Set when account deletion starts (Phase 1 E5). From then on the account is treated as
   * disabled; if deletion is interrupted, the cron job finishes it. Absent on normal accounts.
   */
  deletionPendingAt?: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type ContactPriority = "primary" | "secondary";
/**
 * Invitation lifecycle:
 *   pending ──(invitee claims link)──► awaiting_approval ──(owner approves)──► accepted
 *      │                                     └──(owner rejects)──► claim_rejected ──(resend)──► pending
 *      └──(invitee declines)──► rejected ──(resend)──► pending
 * Only "accepted" grants any access (alerts, location, emergency details).
 */
export type InvitationStatus = "pending" | "awaiting_approval" | "accepted" | "rejected" | "claim_rejected" | "blocked" | "removed";

/** Identity of the account that actually used an invitation link, captured server-side. */
export interface InvitationClaim {
  userId: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  /** Whether the claimant's verified identity matches what the owner typed (null = owner gave none). */
  matchesInvite: { email: boolean | null; phone: boolean | null };
  claimedAt: ISODate;
}

export interface TrustedContact {
  id: string;
  ownerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string;
  priority: ContactPriority;
  status: InvitationStatus;
  /** Set ONLY when the owner approves the claim. Drives all access. */
  contactUserId: string | null;
  /** Who used the invitation link. Shown to the owner for approval; kept after approval as the linked identity. */
  claim: InvitationClaim | null;
  /** SHA-256 hash of the invitation token — the raw token is only ever shown once to the owner. */
  inviteTokenHash: string | null;
  inviteExpiresAt: ISODate | null;
  notifyOnEmergency: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface EmergencyCircle {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  contactIds: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type EmergencyTrigger = "manual" | "voice" | "voice_simulated" | "journey_missed_checkin";
export type EmergencyStatus = "active" | "cancelled" | "resolved";

export interface EmergencyEvent {
  id: string;
  userId: string;
  userName: string;
  trigger: EmergencyTrigger;
  status: EmergencyStatus;
  location: GeoPoint | null;
  /** 0 = primary tier notified, 1 = secondary tier notified. */
  escalationLevel: number;
  escalationConfig: EscalationConfig;
  /** True for demo / simulated events — no real alerts are sent. */
  isSimulated: boolean;
  /** Contact accounts alerted for this event. Access also requires an active link and an unexpired window. */
  authorizedViewerIds: string[];
  /** Set when the event closes (resolved/cancelled) to close time + 24 h. After it, contacts lose access. */
  viewerAccessExpiresAt: ISODate | null;
  /**
   * True from closure until the expiry sweep has removed every viewer (Phase 1 E5). Lets the
   * sweep find only events still needing work. Absent on older events (the API time check
   * still blocks access to those).
   */
  viewerAccessOpen?: boolean;
  note: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  cancelledAt: ISODate | null;
  resolvedAt: ISODate | null;
}

/**
 * Delivery lifecycle of an alert to a single contact.
 * Each transition must be backed by a confirmation from the relevant system
 * (dispatcher accepted → sent; recipient device/inbox confirmed → delivered;
 * recipient action → acknowledged/declined). See core/notification-status.ts.
 */
export const RESPONSE_STATUSES = ["queued", "sent", "delivered", "acknowledged", "declined", "failed"] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];
export type NotificationChannel = "in_app" | "push" | "sms" | "email";

export interface StatusChange {
  status: ResponseStatus;
  at: ISODate;
  detail?: string;
}

/**
 * `activeEmergencies/{userId}`: per-user SOS lock (Phase 1 E5). Created in the same transaction
 * as the emergency, removed in the same transaction that closes it, so two SOS presses can never
 * create two active emergencies. Server-only (denied to clients by the default rule).
 * A lock pointing at an event that is missing or no longer active is stale and is replaced.
 */
export interface ActiveEmergencyLock {
  id: string; // = userId
  userId: string;
  eventId: string;
  createdAt: ISODate;
}

export interface EmergencyResponse {
  id: string;
  eventId: string;
  ownerId: string;
  contactId: string;
  contactUserId: string | null;
  contactName: string;
  tier: ContactPriority;
  channels: NotificationChannel[];
  status: ResponseStatus;
  history: StatusChange[];
  failureReason: string | null;
  /**
   * E5.1: short lease taken (in a transaction) by the request that is sending this still-queued
   * alert, so concurrent duplicate SOS requests can't send it twice. Expires on its own, so an
   * alert whose sender crashed is retried by the next duplicate SOS request.
   */
  dispatchLeaseUntil?: ISODate | null;
  /** E5.1: how many send attempts were started for this alert. */
  dispatchAttempts?: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type NotificationType =
  | "emergency_alert"
  | "emergency_update"
  | "contact_invitation"
  | "invitation_response"
  | "journey_checkin_due"
  | "journey_update"
  | "location_share"
  | "system";

export interface AppNotification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  eventId: string | null;
  read: boolean;
  isSimulated: boolean;
  createdAt: ISODate;
}

export type LocationShareMode = "always" | "temporary";
export type LocationShareStatus = "active" | "paused" | "stopped";

export interface LocationSession {
  id: string;
  ownerId: string;
  contactId: string;
  contactUserId: string | null;
  contactName: string;
  mode: LocationShareMode;
  status: LocationShareStatus;
  expiresAt: ISODate | null;
  lastLocation: GeoPoint | null;
  lastUpdatedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type JourneyStatus = "active" | "arrived" | "cancelled" | "escalated";

export interface JourneySession {
  id: string;
  userId: string;
  origin: string;
  destination: string;
  expectedArrivalAt: ISODate;
  checkInIntervalMinutes: number;
  /** Minutes after a missed check-in before escalation to contacts (if enabled). */
  gracePeriodMinutes: number;
  autoEscalate: boolean;
  contactIds: string[];
  status: JourneyStatus;
  startedAt: ISODate;
  lastCheckInAt: ISODate;
  missedCheckIns: number;
  reminderSentForDueAt: ISODate | null;
  escalatedEventId: string | null;
  endedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type HelperVerificationStatus = "not_submitted" | "pending" | "verified" | "rejected" | "suspended";

export interface HelperProfile {
  id: string;
  userId: string;
  displayName: string;
  verificationStatus: HelperVerificationStatus;
  available: boolean;
  optedIn: boolean;
  /** Coarse location used for matching only. Never shown to requesters. */
  lastKnownLocation: GeoPoint | null;
  serviceRadiusKm: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: ISODate;
}
