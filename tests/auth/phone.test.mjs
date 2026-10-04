import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, requestPhoneCode, verifyPhoneCode } from "../../src/lib/phone-auth.ts";

test("normalizes international numbers and rejects local or malformed numbers", () => {
  assert.equal(normalizePhone(" +91 (98765) 43210 "), "+919876543210");
  for (const value of [
    "9876543210",
    "+0123456789",
    "+91abc9876543210",
    "+123",
    "+1234567890123456",
  ])
    assert.throws(() => normalizePhone(value));
});
test("login never silently creates a new account", async () => {
  let payload;
  await requestPhoneCode(
    {
      signInWithOtp: async (p) => {
        payload = p;
        return { error: null };
      },
    },
    "+919876543210",
    "signin",
  );
  assert.equal(payload.options.shouldCreateUser, false);
  assert.equal(payload.options.channel, "sms");
});
test("explicit signup permits creation without granting a role", async () => {
  let payload;
  await requestPhoneCode(
    {
      signInWithOtp: async (p) => {
        payload = p;
        return { error: null };
      },
    },
    "+919876543210",
    "signup",
  );
  assert.equal(payload.options.shouldCreateUser, true);
  assert.equal(payload.options.data, undefined);
});
test("linking changes the signed-in user instead of signing up", async () => {
  let payload;
  await requestPhoneCode(
    {
      updateUser: async (p) => {
        payload = p;
        return { error: null };
      },
    },
    "+919876543210",
    "link",
  );
  assert.deepEqual(payload, { phone: "+919876543210" });
});
test("provider failures propagate", async () => {
  await assert.rejects(
    requestPhoneCode(
      { signInWithOtp: async () => ({ error: new Error("SMS unavailable") }) },
      "+919876543210",
      "signin",
    ),
    /SMS unavailable/,
  );
});
test("invalid codes do not reach provider; expired codes propagate", async () => {
  await assert.rejects(verifyPhoneCode({}, "+919876543210", "123", false), /6-digit/);
  await assert.rejects(
    verifyPhoneCode(
      { verifyOtp: async () => ({ error: new Error("Expired code") }) },
      "+919876543210",
      "123456",
      false,
    ),
    /Expired/,
  );
});
test("SMS login requires a returned session", async () => {
  let payload;
  const auth = {
    verifyOtp: async (p) => {
      payload = p;
      return { data: { session: {} }, error: null };
    },
  };
  await verifyPhoneCode(auth, "+919876543210", "123456", false);
  assert.equal(payload.type, "sms");
  await assert.rejects(
    verifyPhoneCode(
      { verifyOtp: async () => ({ data: { session: null }, error: null }) },
      "+919876543210",
      "123456",
      false,
    ),
    /No login session/,
  );
});
test("link verification requires confirmed matching auth number", async () => {
  let payload;
  const auth = {
    verifyOtp: async (p) => {
      payload = p;
      return { data: {}, error: null };
    },
    getUser: async () => ({
      data: { user: { phone: "919876543210", phone_confirmed_at: "now" } },
      error: null,
    }),
  };
  await verifyPhoneCode(auth, "+919876543210", "123456", true);
  assert.equal(payload.type, "phone_change");
  auth.getUser = async () => ({
    data: { user: { phone: "919876543211", phone_confirmed_at: "now" } },
    error: null,
  });
  await assert.rejects(verifyPhoneCode(auth, "+919876543210", "123456", true), /incomplete/);
});
