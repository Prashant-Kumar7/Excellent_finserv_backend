/** Public user / member id: literal `EX` + exactly 8 digits (e.g. EX12345678). */
export const EX_EIGHT_REG_NO = /^EX\d{8}$/;

export function isValidExEightRegNo(value: string): boolean {
  return EX_EIGHT_REG_NO.test(value);
}

/** Random EX + 8 digits in [10000000, 99999999] (same range as legacy signup). */
export function generateRandomExEightRegNo(): string {
  return `EX${Math.floor(10000000 + Math.random() * 90000000)}`;
}

/**
 * Map legacy ids to EX######## when possible:
 * - Already `EX` + 8 digits → unchanged
 * - Exactly 10 digits → drop first 2, prefix `EX` (e.g. 9912345678 → EX12345678)
 * - Exactly 8 digits → prefix `EX`
 */
export function proposeExEightFromLegacy(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  if (EX_EIGHT_REG_NO.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `EX${s.slice(2)}`;
  if (/^\d{8}$/.test(s)) return `EX${s}`;
  return null;
}
