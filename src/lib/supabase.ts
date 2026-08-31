import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const LEGACY_DEMO_STORAGE_KEY = "release-form-demo-submissions";

const demoModeRequested = import.meta.env.VITE_RELEASE_FORM_DEMO_MODE === "true";

/**
 * Demo mode is deliberately impossible in a production build. It must also be
 * requested explicitly so a missing environment variable can never turn a
 * production release form into a local fallback.
 */
export const isReleaseFormDemoMode = import.meta.env.MODE !== "production" && demoModeRequested;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

export function clearLegacyDemoSubmissions() {
  if (typeof window === "undefined") return;

  try {
    // Older builds persisted complete release-form payloads here. Remove that
    // legacy browser copy at startup; demo receipts are never persisted now.
    window.localStorage.removeItem(LEGACY_DEMO_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy mode. Failing to clear must not
    // prevent the form from using the server-backed submission path.
  }
}

clearLegacyDemoSubmissions();

function unavailableError() {
  return new Error("Release form service is unavailable. Please contact the studio.");
}

function invalidTokenError() {
  return new Error("This release form link is invalid or expired. Please request a new link from the studio.");
}

export async function submitPublicReleaseForm(token: string | undefined, payload: unknown) {
  if (isReleaseFormDemoMode) {
    // Return an opaque synthetic receipt only. Never copy the submitted health,
    // identity, signature, or document payload into browser storage.
    return { id: `DEMO-${crypto.randomUUID()}`, demo: true as const };
  }

  if (!supabase) throw unavailableError();
  if (!token?.trim() || token === "demo") throw invalidTokenError();

  const { data, error } = await supabase.rpc("submit_public_release_form", {
    p_token: token,
    p_payload: payload,
  });
  if (error) {
    if (/invalid|expired|already used|already submitted/i.test(String(error.message || ""))) {
      throw invalidTokenError();
    }
    throw unavailableError();
  }
  return data;
}

export async function signInStaff(email: string, password: string) {
  if (isReleaseFormDemoMode) return { demo: true as const };
  if (!supabase) throw unavailableError();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Email or password is incorrect.");
  return data;
}
