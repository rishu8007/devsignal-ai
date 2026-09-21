import { ProfessionalProfileModel, type ProfessionalProfileDocument } from "../models/professional-profile.model.js";
import type { ProfessionalProfileInput } from "../validation/professional-profile.validation.js";

export function findProfessionalProfile(ownerId: string): Promise<ProfessionalProfileDocument | null> {
  return ProfessionalProfileModel.findOne({ ownerId }).lean<ProfessionalProfileDocument>().exec();
}

export function saveProfessionalProfile(
  ownerId: string,
  input: ProfessionalProfileInput,
): Promise<ProfessionalProfileDocument | null> {
  const { expectedRevision, ...fields } = input;
  return ProfessionalProfileModel.findOneAndUpdate(
    { ownerId, revision: expectedRevision },
    { $set: fields, $inc: { revision: 1 } },
    { new: true, upsert: expectedRevision === 0, setDefaultsOnInsert: true },
  ).lean<ProfessionalProfileDocument>().exec();
}
