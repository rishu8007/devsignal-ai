import type { Request, Response } from "express";
import { getDatabaseStatus } from "../config/database.js";

export function getHealth(_request: Request, response: Response): void {
  const database = getDatabaseStatus();
  const isHealthy = database === "connected";

  response.status(isHealthy ? 200 : 503).json({
    success: true,
    data: {
      status: isHealthy ? "ok" : "degraded",
      service: "devsignal-api",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database,
    },
  });
}
