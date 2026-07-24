import { cookies } from "next/headers";

export type Locale = "en" | "zh";

const LOCALE_COOKIE = "relaybase_locale";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  return cookieStore.get(LOCALE_COOKIE)?.value === "zh" ? "zh" : "en";
}
