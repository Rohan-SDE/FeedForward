import type { SupabaseClient } from "@supabase/supabase-js";

export function normalizePhone(value: string) {
  const phone = value.trim().replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Include your country code, for example +91 followed by your 10-digit number.");
  }
  return phone;
}

export async function requestPhoneCode(
  auth: SupabaseClient["auth"],
  value: string,
  mode: "signin" | "signup" | "link",
) {
  const phone = normalizePhone(value);
  const { error } =
    mode === "link"
      ? await auth.updateUser({ phone })
      : await auth.signInWithOtp({
          phone,
          options: { shouldCreateUser: mode === "signup", channel: "sms" },
        });
  if (error) throw error;
  return phone;
}

export async function verifyPhoneCode(
  auth: SupabaseClient["auth"],
  phone: string,
  token: string,
  link: boolean,
) {
  if (!/^\d{6}$/.test(token.trim())) throw new Error("Enter the 6-digit SMS code.");
  const { data, error } = await auth.verifyOtp({
    phone: normalizePhone(phone),
    token: token.trim(),
    type: link ? "phone_change" : "sms",
  });
  if (error) throw error;
  if (!link && !data.session) throw new Error("No login session was returned. Request a new code.");
  if (link) {
    const result = await auth.getUser();
    if (result.error) throw result.error;
    if (
      !result.data.user?.phone_confirmed_at ||
      `+${result.data.user.phone?.replace(/^\+/, "")}` !== normalizePhone(phone)
    ) {
      throw new Error(
        "Phone verification is incomplete. Follow any additional confirmation sent to your current number.",
      );
    }
  }
}
