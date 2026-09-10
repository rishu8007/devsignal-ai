import bcrypt from "bcrypt";
import { AppError } from "../errors/app-error.js";
import { createUser, emailExists } from "../repositories/user.repository.js";
import type { RegisterInput } from "../validation/auth.validation.js";

const BCRYPT_COST_FACTOR = 12;
const DUPLICATE_EMAIL_MESSAGE = "An account with this email already exists";

export interface PublicUserDto {
  id: string;
  name: string;
  email: string;
  role: "user";
  createdAt: Date;
}

interface MongoDuplicateKeyError {
  code: 11000;
  keyPattern?: Record<string, number>;
}

export function isMongoDuplicateKeyError(
  error: unknown,
): error is MongoDuplicateKeyError {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const errorCode = error.code;
  return errorCode === 11000;
}

export async function registerUser(input: RegisterInput): Promise<PublicUserDto> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST_FACTOR);

  if (await emailExists(email)) {
    throw new AppError(409, "EMAIL_ALREADY_EXISTS", DUPLICATE_EMAIL_MESSAGE);
  }

  try {
    const user = await createUser(name, email, passwordHash);

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: "user",
      createdAt: user.createdAt,
    };
  } catch (error: unknown) {
    if (isMongoDuplicateKeyError(error)) {
      throw new AppError(409, "EMAIL_ALREADY_EXISTS", DUPLICATE_EMAIL_MESSAGE);
    }

    throw error;
  }
}
