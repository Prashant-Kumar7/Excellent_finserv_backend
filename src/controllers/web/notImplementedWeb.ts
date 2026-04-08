import type { Request, Response } from "express";

export function notImplementedWeb(name: string) {
  return (_req: Request, res: Response) => {
    return res.status(501).send(`${name} not implemented yet in Node backend`);
  };
}

