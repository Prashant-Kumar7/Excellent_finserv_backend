import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../shared/db.js";
import { signUserToken } from "../../shared/auth/jwt.js";
import { generateRandomExSixUniqueDigitRegNo, isStoredMemberRegNo } from "../../shared/regNo.js";

type UserRow = {
  id: number;
  mobile: string;
  password: string;
  regNo: string;
};

type OtpRow = {
  id: number;
  mobile: string;
  otp: string;
  action: string;
  created_at: Date;
};

const MOBILE_REGEX = /^[6-9][0-9]{9}$/;
const MOBILE_FLEX_REGEX = /^[0-9]{10,15}$/;
const REGNO_REGEX = /^EX[0-9]{6}([0-9]{2})?$/;

/** Multer / multipart often yields string or single-element array per field. */
function readFormField(body: Record<string, unknown> | undefined, key: string): string {
  if (!body) return "";
  const raw = body[key];
  if (raw == null) return "";
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first == null) return "";
  return String(first).trim();
}

function normalizeLoginIdInput(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function tokenResponse(user: UserRow) {
  return {
    status: "done",
    access_token: signUserToken({ sub: user.id, mobile: user.mobile, regNo: user.regNo }),
    token_type: "bearer",
    expires_in: Number(process.env.JWT_TTL ?? 43200) * 60
  };
}

async function createOtp(mobile: string, action: "register" | "login" | "forget"): Promise<number> {
  const otp = Math.floor(1000 + Math.random() * 9000);
  const now = new Date();
  await prisma.otp.create({
    data: {
      mobile,
      otp: String(otp),
      action,
      created_at: now,
      updated_at: now
    }
  });
  return otp;
}

async function getLatestOtp(mobile: string, action: string): Promise<OtpRow | null> {
  const row = await prisma.otp.findFirst({
    where: { mobile, action },
    orderBy: { id: "desc" }
  });
  if (!row) return null;
  return {
    id: row.id,
    mobile: row.mobile ?? "",
    otp: row.otp ?? "",
    action: row.action ?? "",
    created_at: row.created_at ?? new Date()
  };
}

async function smsOtp(mobile: string, otp: number) {
  const message = encodeURIComponent(
    `${otp} OTP for Mobile No verification as User for Excellent finserv Pvt Ltd.`
  );
  const url = `http://msg.asterixcommunications.in/rest/services/sendSMS/sendGroupSms?AUTH_KEY=9211fef3624a9684442b925fba54382b&message=${message}&senderId=EXCFIN&routeId=1&mobileNos=${mobile}&smsContentType=english`;
  try {
    await fetch(url);
  } catch {
    // Keep API behavior compatible: do not fail when SMS provider fails.
  }
}

export async function login(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const loginIdRaw =
    readFormField(body, "mobile") ||
    readFormField(body, "phone") ||
    readFormField(body, "regNo") ||
    readFormField(body, "reg_no");
  const password = readFormField(body, "password");

  const loginId = normalizeLoginIdInput(loginIdRaw);
  if (!loginId || password.length < 6) {
    return res.status(422).json({
      status: false,
      message: "Enter your mobile or User ID and a password of at least 6 characters."
    });
  }

  const regKey = loginId.toUpperCase();
  const byRegNo = isStoredMemberRegNo(regKey);
  const byMobile = MOBILE_FLEX_REGEX.test(loginId) && /^\d+$/.test(loginId);

  if (!byRegNo && !byMobile) {
    return res.status(422).json({
      status: false,
      message: "Use a 10-digit mobile number or User ID (e.g. EX000000)."
    });
  }

  const userRaw = await prisma.user.findFirst({
    where: byRegNo ? { regNo: regKey } : { mobile: loginId },
    select: { id: true, mobile: true, password: true, regNo: true }
  });
  const user = userRaw
    ? {
        id: userRaw.id,
        mobile: userRaw.mobile ?? "",
        password: userRaw.password ?? "",
        regNo: userRaw.regNo ?? ""
      }
    : null;
  if (!user) {
    return res
      .status(401)
      .json({ status: false, message: "Invalid mobile number, User ID, or password." });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res
      .status(401)
      .json({ status: false, message: "Invalid mobile number, User ID, or password." });
  }

  return res.json(tokenResponse(user));
}

export async function checkSponsor(req: Request, res: Response) {
  const { mobile, sponser_mobile: sponsorMobileLegacy, sponser_id: sponsorIdRaw } = req.body as {
    mobile?: string;
    sponser_mobile?: string;
    sponser_id?: string;
  };
  const sponsorId = String(sponsorIdRaw ?? sponsorMobileLegacy ?? "").trim().toUpperCase();

  if (!mobile || !MOBILE_REGEX.test(mobile) || !sponsorId || !REGNO_REGEX.test(sponsorId)) {
    return res.status(422).json({ status: false, message: "Validation failed" });
  }

  const existing = await prisma.user.findFirst({ where: { mobile }, select: { id: true } });
  if (existing) {
    return res.status(422).json({ status: false, errors: "Mobile Number is already registered." });
  }

  const sponsor = await prisma.user.findFirst({
    where: { regNo: sponsorId },
    select: { regNo: true }
  });
  if (!sponsor) {
    return res.status(422).json({ status: false, errors: "Sponsor Not Found" });
  }

  const otp = await createOtp(mobile, "register");
  await smsOtp(mobile, otp);
  return res.json({ status: true, action: "register", otp });
}

export async function mobileLogin(req: Request, res: Response) {
  const { mobile } = req.body as { mobile?: string };
  if (!mobile || !MOBILE_REGEX.test(mobile)) {
    return res.status(422).json({ status: false, message: "Validation failed" });
  }

  const user = await prisma.user.findFirst({
    where: { mobile },
    select: { id: true }
  });
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found." });
  }

  const lastOtp = await getLatestOtp(mobile, "login");
  if (lastOtp) {
    const seconds = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
    if (seconds < 60) {
      return res
        .status(429)
        .json({ status: false, message: "Please wait 60 seconds before requesting a new OTP." });
    }
  }

  const otp = await createOtp(mobile, "login");
  await smsOtp(mobile, otp);
  return res.json({ status: true, message: "OTP sent successfully.", otp });
}

export async function loginWithOtp(req: Request, res: Response) {
  const { mobile, otp } = req.body as { mobile?: string; otp?: string };
  if (!mobile || !MOBILE_REGEX.test(mobile) || !otp || !/^[0-9]{4}$/.test(String(otp))) {
    return res.status(422).json({ status: false, v_errors: { mobile: ["Invalid mobile/otp"] } });
  }

  const threshold = new Date(Date.now() - 5 * 60 * 1000);
  const otpRowRaw = await prisma.otp.findFirst({
    where: {
      mobile,
      otp: String(otp),
      action: "login",
      created_at: { gte: threshold }
    },
    orderBy: { id: "desc" }
  });

  if (!otpRowRaw) {
    return res.status(422).json({ status: false, message: "Invalid or expired OTP." });
  }

  const attempts = await prisma.otp.count({
    where: { mobile, action: "login", created_at: { gte: threshold } }
  });
  if (attempts > 5) {
    return res.status(429).json({ status: false, message: "Too many attempts. Please request a new OTP." });
  }

  const userRaw = await prisma.user.findFirst({
    where: { mobile },
    select: { id: true, mobile: true, password: true, regNo: true }
  });
  const user = userRaw
    ? {
        id: userRaw.id,
        mobile: userRaw.mobile ?? "",
        password: userRaw.password ?? "",
        regNo: userRaw.regNo ?? ""
      }
    : null;
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found." });
  }

  await prisma.otp.delete({ where: { id: otpRowRaw.id } });
  return res.json(tokenResponse(user));
}

export async function registerWithOtp(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const mobile = readFormField(body, "mobile");
  const otp = readFormField(body, "otp");
  const name = readFormField(body, "name");
  const lastName = readFormField(body, "last_name");
  const sponsorId = (readFormField(body, "sponser_id") || readFormField(body, "sponser_mobile"))
    .trim()
    .toUpperCase();
  const referralCodeRaw =
    readFormField(body, "referral_code") || readFormField(body, "referralCode") || readFormField(body, "ref_code");
  const password = readFormField(body, "password");

  if (
    !mobile ||
    !MOBILE_REGEX.test(mobile) ||
    !otp ||
    !/^[0-9]{4}$/.test(String(otp)) ||
    !name ||
    !lastName ||
    !sponsorId ||
    !REGNO_REGEX.test(sponsorId) ||
    !password ||
    password.length < 6
  ) {
    return res.status(422).json({ status: false, v_errors: { mobile: ["Validation failed"] } });
  }

  try {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    const otpData = await prisma.otp.findFirst({
      where: {
        mobile,
        otp: String(otp),
        action: "register",
        created_at: { gte: threshold }
      },
      orderBy: { id: "desc" }
    });
    if (!otpData) {
      return res.status(422).json({ status: false, message: "Invalid or expired OTP." });
    }

    const exists = await prisma.user.findFirst({ where: { mobile }, select: { id: true } });
    if (exists) {
      return res.status(422).json({ status: false, message: "Mobile number is already registered." });
    }

    const sponsor = await prisma.user.findFirst({
      where: { regNo: sponsorId },
      select: { regNo: true }
    });
    if (!sponsor) {
      return res.status(422).json({ status: false, message: "Sponsor not found." });
    }

    let regNo = "";
    while (!regNo) {
      const candidate = generateRandomExSixUniqueDigitRegNo();
      const existingReg = await prisma.user.findFirst({ where: { regNo: candidate }, select: { id: true } });
      if (!existingReg) {
        regNo = candidate;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await prisma.$transaction(async (tx) => {
      const referralCode = referralCodeRaw.trim().toUpperCase();
      let referrerUserId: number | null = null;
      if (referralCode.length > 0) {
        const referrer = await tx.user.findFirst({
          where: {
            OR: [{ referral_code: referralCode }, { regNo: referralCode }],
            NOT: { mobile }
          },
          select: { id: true }
        });
        if (referrer) {
          referrerUserId = referrer.id;
        }
      }

      const created = await tx.user.create({
        data: {
          mobile,
          name,
          last_name: lastName,
          password: hashedPassword,
          sponser_id: sponsor.regNo ?? null,
          regNo,
          referral_code: regNo
        },
        select: { id: true }
      });

      if (referrerUserId != null && referrerUserId !== created.id) {
        // Creates a "pending referral" for reward-on-Aadhaar-KYC.
        // Unique constraint on referredUserId prevents duplicates.
        await tx.referral.create({
          data: {
            referrerUserId,
            referredUserId: created.id,
            status: "pending",
            rewardGiven: false
          }
        });
      }

      await tx.coin.create({
        data: {
          regNo,
          amount: 100,
          comment: "Self_Income"
        }
      });
      await tx.otp.delete({ where: { id: otpData.id } });
      return created.id;
    });

    return res.json(
      tokenResponse({
        id: userId,
        mobile,
        password: hashedPassword,
        regNo
      })
    );
  } catch {
    return res.status(500).json({ status: false, message: "Registration failed. Please try again." });
  }
}

export async function sendForgetOtp(req: Request, res: Response) {
  const { mobile } = req.body as { mobile?: string };
  if (!mobile || !MOBILE_REGEX.test(mobile)) {
    return res.status(422).json({ status: false, v_errors: { mobile: ["Validation failed"] } });
  }

  const user = await prisma.user.findFirst({
    where: { mobile },
    select: { id: true }
  });
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found." });
  }

  const lastOtp = await getLatestOtp(mobile, "forget");
  if (lastOtp) {
    const seconds = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
    if (seconds < 60) {
      return res
        .status(429)
        .json({ status: false, message: "Please wait 60 seconds before requesting a new OTP." });
    }
  }

  const otp = await createOtp(mobile, "forget");
  await smsOtp(mobile, otp);
  return res.json({ status: true, message: "OTP sent successfully.", otp });
}

export async function resetPasswordWithOtp(req: Request, res: Response) {
  const { mobile, otp, password } = req.body as { mobile?: string; otp?: string; password?: string };
  if (!mobile || !MOBILE_REGEX.test(mobile) || !otp || !password || password.length < 6) {
    return res.status(422).json({ status: false, v_errors: { mobile: ["Validation failed"] } });
  }

  const threshold = new Date(Date.now() - 5 * 60 * 1000);
  const attempts = await prisma.otp.count({
    where: { mobile, action: "forget", created_at: { gte: threshold } }
  });
  if (attempts > 5) {
    return res.status(429).json({ status: false, message: "Too many attempts. Please request a new OTP." });
  }

  const otpDataRaw = await prisma.otp.findFirst({
    where: { mobile, action: "forget" },
    orderBy: { id: "desc" }
  });
  const otpData = otpDataRaw
    ? {
        id: otpDataRaw.id,
        mobile: otpDataRaw.mobile ?? "",
        otp: otpDataRaw.otp ?? "",
        action: otpDataRaw.action ?? "",
        created_at: otpDataRaw.created_at ?? new Date()
      }
    : null;
  if (!otpData) {
    return res.status(422).json({ status: false, message: "OTP not found." });
  }

  if (String(otpData.otp) !== String(otp)) {
    return res.status(422).json({ status: false, message: "Invalid OTP." });
  }

  const isExpired = Date.now() - new Date(otpData.created_at).getTime() > 5 * 60 * 1000;
  if (isExpired) {
    return res.status(422).json({ status: false, message: "OTP expired." });
  }

  const userRaw = await prisma.user.findFirst({
    where: { mobile },
    select: { id: true, mobile: true, password: true, regNo: true }
  });
  const user = userRaw
    ? {
        id: userRaw.id,
        mobile: userRaw.mobile ?? "",
        password: userRaw.password ?? "",
        regNo: userRaw.regNo ?? ""
      }
    : null;
  if (!user) {
    return res.status(404).json({ status: false, message: "User not found." });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword }
  });
  await prisma.otp.delete({ where: { id: otpData.id } });
  return res.json({ status: true, message: "Password reset successfully." });
}

