import { UserModel } from "../models/user.model.js";

type CreateResult = Awaited<ReturnType<typeof UserModel.create>>;
export type CreatedUser = CreateResult extends readonly (infer Item)[]
  ? Item
  : CreateResult;

export async function emailExists(email: string): Promise<boolean> {
  return (await UserModel.exists({ email })) !== null;
}

export async function createUser(
  name: string,
  email: string,
  passwordHash: string,
): Promise<CreatedUser> {
  return UserModel.create({ name, email, passwordHash });
}
