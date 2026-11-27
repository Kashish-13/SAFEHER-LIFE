import { MemoryStore } from "@/server/store/memory";
import { defineStoreContract } from "./contract";

// The in-memory store used by demo mode and unit tests must satisfy the full store contract.
defineStoreContract("MemoryStore", async () => new MemoryStore());
