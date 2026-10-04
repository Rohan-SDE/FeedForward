import test from "node:test";
import assert from "node:assert/strict";
import { finishOAuthSignIn } from "../../src/lib/oauth.ts";

function dependencies(roles = []) {
  const calls = [];
  return {
    calls,
    getSession: async () => {
      calls.push("session");
      return { data: { session: { access_token: "test" } }, error: null };
    },
    clearCallbackUrl: () => calls.push("clearUrl"),
    clearAccountCache: async () => {
      calls.push("clearCache");
    },
    getAccount: async () => {
      calls.push("account");
      return { roles };
    },
  };
}
for (const role of ["donor", "ngo", "volunteer", "admin"]) {
  test(`Google login retains saved ${role} role and clears previous account cache`, async () => {
    const deps = dependencies([role]);
    assert.equal(
      await finishOAuthSignIn("https://example.test/auth/callback?role=admin", deps),
      role === "admin" ? "/admin" : "/dashboard",
    );
    assert.deepEqual(deps.calls, ["session", "clearUrl", "clearCache", "account"]);
  });
}
test("new Google user chooses a role through onboarding; URL cannot grant admin", async () => {
  assert.equal(
    await finishOAuthSignIn("https://example.test/auth/callback?role=admin", dependencies()),
    "/profile",
  );
});
test("cancelled Google consent never uses an old session", async () => {
  const deps = dependencies(["admin"]);
  await assert.rejects(
    finishOAuthSignIn("https://example.test/auth/callback#error=access_denied", deps),
    /cancelled/,
  );
  assert.deepEqual(deps.calls, ["clearUrl"]);
});
test("missing or expired OAuth session does not load a profile", async () => {
  const deps = dependencies();
  deps.getSession = async () => ({ data: { session: null }, error: null });
  await assert.rejects(
    finishOAuthSignIn("https://example.test/auth/callback", deps),
    /missing or expired/,
  );
  assert.deepEqual(deps.calls, ["clearUrl"]);
});
test("failed session initialization still removes callback credentials", async () => {
  const deps = dependencies();
  deps.getSession = async () => {
    throw Error("Session failure");
  };
  await assert.rejects(
    finishOAuthSignIn("https://example.test/auth/callback#access_token=test", deps),
    /Session failure/,
  );
  assert.deepEqual(deps.calls, ["clearUrl"]);
});
test("backend failure is surfaced rather than silently creating another role", async () => {
  const deps = dependencies();
  deps.getAccount = async () => {
    throw Error("Server unavailable");
  };
  await assert.rejects(
    finishOAuthSignIn("https://example.test/auth/callback", deps),
    /Server unavailable/,
  );
});
