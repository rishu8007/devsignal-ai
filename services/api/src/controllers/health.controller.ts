import type { Request, Response } from "express";

export function getHealth(_request: Request, response: Response): void {
  response.status(200).json({
    success: true,
    data: {
      status: "ok",
      service: "devsignal-api",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
}
