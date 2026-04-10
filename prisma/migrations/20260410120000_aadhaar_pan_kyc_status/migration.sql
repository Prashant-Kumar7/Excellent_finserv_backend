-- Per-method DigiLocker status (1 = verified, 2 = failed). Legacy `kyc_status` is not updated by new webhooks.

ALTER TABLE "users" ADD COLUMN "aadhaar_kyc_status" INTEGER;
ALTER TABLE "users" ADD COLUMN "pan_kyc_status" INTEGER;
