# Future mobile app (React Native + Kotlin)

The mobile app reuses the **same REST API, Firebase project and `src/core` domain logic**. No backend changes are needed for
the MVP; the emergency trigger API already accepts `trigger: "voice"`.

## Stack
React Native (TypeScript) · `@react-native-firebase/{app,auth,messaging}` · Kotlin native module for voice detection ·
`react-native-background-geolocation` (or a Kotlin fused-location module) · WebRTC (`react-native-webrtc` or a managed
provider such as LiveKit/Agora) for voice rooms.

## Reuse
* Copy/publish `src/core` as `@safeher/core` (types, zod schemas, escalation/journey/geo logic, permissions).
* Implement `api()` with the same contract as `src/lib/api-client.ts`, using `auth().currentUser.getIdToken()`.

## Voice-activated SOS on Android

| Concern | Plan |
|---|---|
| Detection | On-device keyword spotting (e.g. Picovoice Porcupine custom wake word, or TensorFlow Lite KWS). **No raw audio leaves the device.** |
| Running while locked | `ForegroundService` with `foregroundServiceType="microphone"` and a **persistent, non-dismissable notification** ("SafeHer is listening for your phrase") |
| Permissions | `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`. Android 14+ requires the service to start while the app is visible |
| Battery | Prompt for battery-optimisation exemption with clear explanation; handle OEM killers (Xiaomi, Oppo, Samsung). See dontkillmyapp.com |
| False activations | Local countdown of `voiceSos.falseActivationWindowSeconds` with a full-screen cancel UI before calling the API |
| Sensitivity | Map `voiceSos.sensitivity` to the engine's threshold |
| Failure modes | Network retry with backoff; queue the trigger locally; show a 112 dial prompt; manual SOS always available |
| Testing | Physical devices only (emulators don't reflect Doze/OEM behaviour): locked screen, low battery, airplane-mode recovery |

**Never claim guaranteed background detection.** Android may still stop the service; the UI must show live monitoring status.

## iOS
iOS does not allow arbitrary always-on background microphone listening for this use case. Expect: foreground detection,
Siri Shortcut / Action Button to trigger SOS, and Critical Alerts entitlement (requires Apple approval) for contact notifications.

## Background location
Only with explicit opt-in per sharing session; show the OS indicator; stop when the session ends/expires.

## Push
Register FCM tokens via `POST /api/me/push-token`. The server already sends high-priority Android / APNs priority-10 messages
for real (non-simulated) emergencies. On receipt, call `POST /api/emergencies/:id/respond {action:"delivered"}` to record true
device delivery.
