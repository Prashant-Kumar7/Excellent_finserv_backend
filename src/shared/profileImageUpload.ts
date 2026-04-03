import { getSupabaseAdmin, PROFILE_BUCKET } from "./supabase.js";

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
    throw error;
  }

  const { data } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
