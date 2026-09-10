import bcrypt from "bcrypt";
import { createAccessToken } from "../config/jwt.js";
import { AppError } from "../errors/app-error.js";
import {
  createUser,
  emailExists,
  findPublicUserById,
  findUserForAuthentication,
} from "../repositories/user.repository.js";
import type { LoginInput, RegisterInput } from "../validation/auth.validation.js";

const BCRYPT_COST_FACTOR = 12;
const DUPLICATE_EMAIL_MESSAGE = "An account with this email already exists";
const DUMMY_PASSWORD_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEe.1P1Q9j7zQzQzQzQzQzQzQzQzQzQzQzQzQzQz";

export interface PublicUserDto {
  id: string;
  name: string;
  email: string;
  role: "user";
  createdAt: Date;
}

export interface LoginResult {
  user: PublicUserDto;
  token: string;
}

function toPublicUserDto(user: {
  _id: { toString(): string };
  name: string;
  email: string;
  createdAt: Date;
}): PublicUserDto {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: "user",
    createdAt: user.createdAt,
  };
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

    return toPublicUserDto(user);
  } catch (error: unknown) {
    if (isMongoDuplicateKeyError(error)) {
      throw new AppError(409, "EMAIL_ALREADY_EXISTS", DUPLICATE_EMAIL_MESSAGE);
    }

    throw error;
  }
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const user = await findUserForAuthentication(input.email);
  const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await bcrypt.compare(input.password, passwordHash);

  if (!user || !passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  return {
    user: toPublicUserDto(user),
    token: createAccessToken(user._id.toString()),
  };
}

export async function getCurrentUser(userId: string): Promise<PublicUserDto> {
  const user = await findPublicUserById(userId);

  if (!user) {
    throw new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required");
  }

  return toPublicUserDto(user);
}
