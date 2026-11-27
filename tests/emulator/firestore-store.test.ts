import { afterAll } from "vitest";
import { FirestoreStore } from "@/server/store/firestore";
import { defineStoreContract } from "../store/contract";
import { clearEmulator, closeEmulatorApps, emulatorDb } from "./harness";

// The SAME contract MemoryStore passes, run against FirestoreStore on the local emulator.
defineStoreContract("FirestoreStore (local emulator)", async () => {
  await clearEmulator();
  return new FirestoreStore(emulatorDb());
});

afterAll(closeEmulatorApps);
