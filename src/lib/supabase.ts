import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

export async function submitPublicReleaseForm(token: string | undefined, payload: unknown) {
  if (!supabase || !token) {
    const existing = JSON.parse(localStorage.getItem("release-form-demo-submissions") || "[]");
    const stored = {
      id: crypto.randomUUID(),
      submitted_at: new Date().toISOString(),
      payload,
    };
    localStorage.setItem("release-form-demo-submissions", JSON.stringify([stored, ...existing]));
    return { id: stored.id, demo: true };
  }

  const { data, error } = await supabase.rpc("submit_public_release_form", {
    p_token: token,
    p_payload: payload,
  });
  if (error) throw error;
  return data;
}

export async function signInStaff(email: string, password: string) {
  if (!supabase) return { demo: true };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

