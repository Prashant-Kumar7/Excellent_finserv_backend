import { Router } from "express";
import { startVkyc } from "../controllers/api/vkycController.js";
import { requireUserAuth } from "../shared/middleware/userAuth.js";

export const vkycRouter = Router();

// All VKYC routes require authenticated user
vkycRouter.use(requireUserAuth);

// POST /api/vkyc/start
vkycRouter.post("/start", startVkyc);

