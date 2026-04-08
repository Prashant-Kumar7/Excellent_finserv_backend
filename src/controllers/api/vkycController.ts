import type { Response } from "express";
import { prisma } from "../../shared/db.js";
import type { AuthenticatedRequest } from "../../shared/middleware/userAuth.js";
import { getOAuthToken, createVkycUser, initiateVkyc } from "../../services/cashfreeVkycService.js";

export async function startVkyc(req: AuthenticatedRequest, res: Response) {
  const authUser = req.user;
  if (!authUser) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        regNo: true
      }
    });

    if (!dbUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const mobile = String(dbUser.mobile ?? "").trim();
    if (!mobile) {
      return res
        .status(422)
        .json({ success: false, message: "Mobile number is required for VKYC" });
    }

    // 1) Ensure we have a valid OAuth token (also returned to the client)
    const token = await getOAuthToken();

    // 2) Create VKYC user on Cashfree side
    const cfUser = await createVkycUser({
      id: dbUser.id,
      name: dbUser.name ?? null,
      email: dbUser.email ?? null,
      phone: mobile
    });

    // 3) Initiate VKYC session
    const init = await initiateVkyc(cfUser.user_id);

    // 4) Persist verification id + status
    await prisma.user.updateMany({
      where: { id: dbUser.id },
      data: {
        vkyc_verification_id: init.verification_id,
        vkyc_status: "PENDING",
        vkyc_completed_at: null,
        updated_at: new Date()
      }
    });

    return res.json({
      success: true,
      srcUrl: init.vkyc_url,
      token: token.accessToken
    });
  } catch (e: unknown) {
    console.error("VKYC start error", e);
    return res.status(502).json({
      success: false,
      message: "Unable to start video KYC at the moment. Please try again."
    });
  }
}

