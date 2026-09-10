import { UserModel } from "../models/user.model.js";

type CreateResult = Awaited<ReturnType<typeof UserModel.create>>;
export type CreatedUser = CreateResult extends readonly (infer Item)[]
  ? Item
  : CreateResult;

export async function emailExists(email: string): Promise<boolean> {
  return (await UserModel.exists({ email })) !== null;
}

export async function findUserForAuthentication(email: string): Promise<CreatedUser | null> {
  return UserModel.findOne({ email }).select("+passwordHash").exec();
}

export async function findPublicUserById(userId: string): Promise<CreatedUser | null> {
  return UserModel.findById(userId).select("-passwordHash").exec();
}

export async function createUser(
  name: string,
  email: string,
  passwordHash: string,
): Promise<CreatedUser> {
  return UserModel.create({ name, email, passwordHash });
}
