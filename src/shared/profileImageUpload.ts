import { getSupabaseAdmin, PROFILE_BUCKET } from "./supabase.js";

/** Long enough for CachedNetworkImage; refresh on next dashboard load. */
const SIGNED_AVATAR_TTL_SEC = 60 * 60 * 24 * 7;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadUserProfileImage(
  buffer: Buffer,
  mimetype: string,
  regNo: string
): Promise<string> {
  const mime = mimetype.toLowerCase();
  if (!ALLOWED_TYPES.has(mime)) {
    throw new Error("invalid_image_type");
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error("image_too_large");
  }

  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const safeReg = regNo.replace(/[^a-zA-Z0-9_-]/g, "_");
  const objectPath = `${safeReg}/${Date.now()}.${ext}`;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(PROFILE_BUCKET).upload(objectPath, buffer, {
    contentType: mime,
    upsert: false
  });

  if (error) {
    throw new Error(error.message || "storage_upload_failed");
  }

  const { data } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Turns a Supabase Storage public URL into a time-limited signed URL so the app can load
 * images when the bucket is private or public URLs are misconfigured.
 */
export async function signSupabaseAvatarUrl(
  storedUrl: string | null | undefined
): Promise<string | null | undefined> {
  if (!storedUrl?.trim()) return storedUrl;
  const s = storedUrl.trim();
  if (!s.includes("supabase.co") || !s.includes("/storage/v1/object/")) return storedUrl;

  try {
    const u = new URL(s);
    const m = u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/);
    if (!m?.[1] || !m[2]) return storedUrl;
    const bucket = m[1];
    const objectPath = decodeURIComponent(m[2]);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, SIGNED_AVATAR_TTL_SEC);
    if (error || !data?.signedUrl) {
      return storedUrl;
    }
    return data.signedUrl;
  } catch {
    return storedUrl;
  }
}
