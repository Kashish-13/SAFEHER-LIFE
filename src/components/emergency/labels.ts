import type { EmergencyEvent } from "@/core/types";

export const TRIGGER_LABEL: Record<EmergencyEvent["trigger"], string> = {
  manual: "Manual SOS",
  voice: "Voice SOS",
  voice_simulated: "Voice SOS (simulated)",
  journey_missed_checkin: "Missed journey check-in",
};
