import type { Request, Response } from "express";

export function notImplemented(name: string) {
  return (_req: Request, res: Response) => {
    return res.status(501).json({
      status: "error",
      message: `${name} not implemented yet in Node backend`
    });
  };
}

