import type { EmergencyPreferences, PrivacySettings, UserProfile, VoiceSosSettings } from "./types";

export const DEFAULT_EMERGENCY_PREFERENCES: EmergencyPreferences = {
  confirmBeforeSOS: false,
  cancelWindowSeconds: 5,
  shareLocationOnSOS: true,
  notifyCircleIds: [],
  escalation: { enabled: true, primaryTimeoutSeconds: 120 },
};

export const DEFAULT_VOICE_SOS: VoiceSosSettings = {
  enabled: false,
  phrase: "Help Help",
  sensitivity: 0.6,
  falseActivationWindowSeconds: 10,
};

export const DEFAULT_PRIVACY: PrivacySettings = {
  allowHelperRequests: false,
  historyRetentionDays: 365,
};

export function newUserProfile(input: { id: string; fullName: string; email: string; phone?: string | null; now: string }): UserProfile {
  return {
    id: input.id,
    fullName: input.fullName,
    email: input.email,
    emailVerified: false,
    phone: input.phone ?? null,
    phoneVerified: false,
    photoURL: null,
    language: "en",
    roles: ["user"],
    onboardingComplete: false,
    emergencyPreferences: DEFAULT_EMERGENCY_PREFERENCES,
    voiceSos: DEFAULT_VOICE_SOS,
    privacy: DEFAULT_PRIVACY,
    fcmTokens: [],
    tokenVersion: 0,
    disabled: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Demo mode only: OTP delivery is simulated and this fixed code is displayed on screen. */
export const DEMO_OTP_CODE = "123456";

/** India emergency numbers (user-initiated dialing only — SafeHer is not integrated with dispatch). */
export const INDIA_EMERGENCY_NUMBERS = [
  { number: "112", label: "National Emergency (Police · Fire · Ambulance)", primary: true },
  { number: "181", label: "Women Helpline (Domestic abuse & distress)", primary: false },
  { number: "1091", label: "Women Helpline (Police)", primary: false },
  { number: "108", label: "Ambulance / Medical emergency", primary: false },
  { number: "1930", label: "Cyber Crime Helpline", primary: false },
  { number: "1098", label: "Childline", primary: false },
] as const;
