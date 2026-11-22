import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture, type Fixture, key, origin } from "./workflow-fixture";
import { createHandler } from "../src/server/http";
import { hash, MemoryRateLimiter } from "../src/server/security";
import { usedLiffTokens } from "../src/server/db/workflow-schema";
let f: Fixture;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f.pg.close();
});
const base = () => ({
  iss: "https://access.line.me",
  aud: "liff-channel",
  exp: Math.floor(+f.clock.now / 1000) + 600,
  iat: Math.floor(+f.clock.now / 1000),
  sub: "fictional-liff-subject",
});
async function login(
  token: string,
  patch: Record<string, unknown> = {},
  options: { cookie?: boolean; cookieNonce?: string; nonce?: string; origin?: string } = {},
) {
  const nonce = options.nonce ?? (await f.auth.challenge());
  const handler = createHandler(
    "liff",
    () => f.auth,
    origin,
    new MemoryRateLimiter(100),
    {
      channel: "liff-channel",
      key,
      verifier: async (t, channel) => {
        expect(channel).toBe("liff-channel");
        if (t === "fake") throw Error("private");
        return { ...base(), ...patch };
      },
    },
  );
  return handler(
    new Request(origin + "/api/auth/liff", {
      method: "POST",
      headers: {
        origin: options.origin ?? origin,
        "content-type": "application/json",
        "x-mc-csrf": "1",
        cookie: options.cookie === false ? "" : `__Host-mc_nonce=${options.cookieNonce ?? nonce}`,
      },
      body: JSON.stringify({ idToken: token, nonce }),
    }),
  );
}
it("LIFF accepts a fresh verified token, stores only its replay hash and issues a secure session", async () => {
  const response = await login("fresh-fictional-token");
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain(
    "HttpOnly; Secure; SameSite=Lax",
  );
  expect(await response.json()).toMatchObject({
    data: { authenticated: true },
    request_id: expect.any(String),
  });
  const rows = await f.db.select().from(usedLiffTokens);
  expect(rows).toEqual([
    expect.objectContaining({ tokenHash: hash("fresh-fictional-token") }),
  ]);
});
it("LIFF rejects fake, expired, wrong audience/issuer, stale/future iat and missing claims", async () => {
  for (const patch of [
    { exp: 1 },
    { aud: "wrong" },
    { iss: "https://evil.example" },
    { iat: Math.floor(+f.clock.now / 1000) - 301 },
    { iat: Math.floor(+f.clock.now / 1000) + 31 },
    { iat: undefined },
  ]) {
    expect((await login(crypto.randomUUID(), patch)).status).toBe(401);
  }
  const response = await login("fake");
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("private");
});
it("LIFF rejects token replay across fresh challenges, including concurrent requests", async () => {
  const results = await Promise.all([
    login("concurrent-token"),
    login("concurrent-token"),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  expect((await login("concurrent-token")).status).toBe(401);
});
it("LIFF requires a browser-bound, unexpired one-use challenge and matching Origin", async () => {
  expect((await login("missing", {}, { cookie: false })).status).toBe(401);
  expect((await login("mismatched", {}, {cookieNonce:await f.auth.challenge()})).status).toBe(401);
  expect(
    (await login("unknown", {}, { nonce: "not-a-server-issued-challenge" }))
      .status,
  ).toBe(401);
  expect(
    (await login("origin", {}, { origin: "https://evil.example" })).status,
  ).toBe(403);
  const nonce = await f.auth.challenge();
  expect((await login("challenge-first", {}, { nonce })).status).toBe(200);
  expect((await login("challenge-second", {}, { nonce })).status).toBe(401);
  const expired = await f.auth.challenge();
  f.clock.now = new Date(+f.clock.now + 301000);
  expect(
    (await login("expired-challenge", {}, { nonce: expired })).status,
  ).toBe(401);
});
