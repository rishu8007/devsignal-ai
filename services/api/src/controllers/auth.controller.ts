import type { Request, Response } from "express";
import { registerUser } from "../services/auth.service.js";

export async function register(request: Request, response: Response): Promise<void> {
  const user = await registerUser(request.body);
  response.status(201).json({
    success: true,
    data: {
      user,
    },
  });
}
