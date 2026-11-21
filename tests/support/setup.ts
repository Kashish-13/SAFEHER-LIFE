import { NextRequest } from "next/server";
import { seedDemoData } from "@/server/demo/seed";
import { signDemoToken } from "@/server/demo-token";
import { __resetRateLimits } from "@/server/rate-limit";
import { __setStoreForTests } from "@/server/store";
import { MemoryStore } from "@/server/store/memory";
import type { UserProfile } from "@/core/types";
import { COLLECTIONS } from "@/server/store/types";

/** Fresh, seeded in-memory store per test. All data is simulated. */
export async function freshStore() {
  const store = new MemoryStore();
  await seedDemoData(store);
  __setStoreForTests(store);
  __resetRateLimits();
  return store;
}

export async function profile(store: MemoryStore, id: string) {
  return (await store.get<UserProfile>(COLLECTIONS.users, id))!;
}

export function req(method: string, path: string, opts: { as?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = opts.token ?? (opts.as ? signDemoToken(opts.as) : undefined);
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const params = <T extends Record<string, string>>(p: T = {} as T) => ({ params: Promise.resolve(p) });
