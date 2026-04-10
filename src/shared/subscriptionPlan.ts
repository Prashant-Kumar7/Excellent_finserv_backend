/** Base package amounts (₹) — must match Flutter `subscription_plans.dart`. */
export const PACKAGE_AMOUNTS = [2500, 7500, 15000] as const;

export type PackageAmount = (typeof PACKAGE_AMOUNTS)[number];

export function isKnownPackageAmount(amount: number): boolean {
  return PACKAGE_AMOUNTS.includes(amount as PackageAmount);
}

/** 0 = Bronze … 2 = Gold; -1 if unknown. */
export function packageTierIndex(amount: number): number {
  return PACKAGE_AMOUNTS.indexOf(amount as PackageAmount);
}

export type PerdayLike = {
  amount: unknown;
  created_at: Date | null;
};

/**
 * Latest `perday` row defines current tier. Optional `SUBSCRIPTION_VALIDITY_DAYS`
 * treats the subscription as inactive after that many days from `created_at`
 * (0 or unset = no time limit).
 */
export function getEffectiveCurrentPackageAmount(latest: PerdayLike | null): number {
  if (!latest) return 0;
  const amt = Number(latest.amount ?? 0);
  if (!Number.isFinite(amt) || !isKnownPackageAmount(amt)) return 0;

  const validityDays = Number(process.env.SUBSCRIPTION_VALIDITY_DAYS ?? 0);
  if (validityDays > 0 && latest.created_at) {
    const expiresMs = latest.created_at.getTime() + validityDays * 86400000;
    if (Date.now() > expiresMs) return 0;
  }
  return amt;
}

/** `null` = allowed; otherwise error message for API responses. */
export function validatePackageUpgrade(currentAmount: number, requestedAmount: number): string | null {
  if (!isKnownPackageAmount(requestedAmount)) {
    return "Invalid package amount.";
  }
  if (currentAmount === 0 || !isKnownPackageAmount(currentAmount)) {
    return null;
  }
  const cur = packageTierIndex(currentAmount);
  const req = packageTierIndex(requestedAmount);
  if (req <= cur) {
    return "You can only purchase a higher plan while your current subscription is active.";
  }
  return null;
}
