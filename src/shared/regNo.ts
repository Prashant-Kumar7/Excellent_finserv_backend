/** Canonical member id: literal `EX` + exactly 6 digits (e.g. EX123456). */
export const EX_SIX_REG_NO = /^EX\d{6}$/;

/** Legacy ids from earlier migrations (EX + 8 digits). Still accepted in DB / verification. */
export const EX_EIGHT_REG_NO = /^EX\d{8}$/;

export function isValidExSixRegNo(value: string): boolean {
  return EX_SIX_REG_NO.test(value);
}

/** True for EX###### (new) or EX######## (legacy). */
export function isStoredMemberRegNo(value: string): boolean {
  return EX_SIX_REG_NO.test(value) || EX_EIGHT_REG_NO.test(value);
}

/**
 * New signup ids: `EX` + 6 digits, each digit 0–9 used at most once in the numeric part
 * (e.g. EX381592 allowed; EX112233 not).
 */
export function generateRandomExSixUniqueDigitRegNo(): string {
  const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = digits[i]!;
    digits[i] = digits[j]!;
    digits[j] = t;
  }
  return `EX${digits.slice(0, 6).join("")}`;
}

/**
 * Map legacy strings toward EX###### when possible:
 * - Already EX###### or EX######## → unchanged
 * - Exactly 10 digits → EX + last 6 digits
 * - Exactly 8 digits → EX + last 6 digits
 * - Exactly 6 digits → EX + those digits
 */
export function proposeMemberIdFromLegacy(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  if (EX_SIX_REG_NO.test(s) || EX_EIGHT_REG_NO.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `EX${s.slice(-6)}`;
  if (/^\d{8}$/.test(s)) return `EX${s.slice(-6)}`;
  if (/^\d{6}$/.test(s)) return `EX${s}`;
  return null;
}

/** @deprecated Use generateRandomExSixUniqueDigitRegNo */
export const generateRandomExEightRegNo = generateRandomExSixUniqueDigitRegNo;

/** @deprecated Use proposeMemberIdFromLegacy */
export const proposeExEightFromLegacy = proposeMemberIdFromLegacy;
