import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const PROFILE_BUCKET = process.env.SUPABASE_PROFILE_BUCKET ?? "profile-images";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  if (!adminClient) {
    adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return adminClient;
}
