import type { NextFunction, Request, Response } from "express";

export function requireGlobalApiKey(req: Request, res: Response, next: NextFunction) {
  const configuredKey = process.env.API_KEY;
  const headerKey = req.headers["x-api-key"] ?? req.headers["api_key"];

  if (!configuredKey) {
    return res.status(500).json({ status: "error", message: "API key not configured" });
  }

  if (typeof headerKey !== "string" || headerKey !== configuredKey) {
    return res.status(401).json({ status: "error", message: "Invalid API key" });
  }

  return next();
}

