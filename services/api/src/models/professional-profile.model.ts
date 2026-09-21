import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 2000 },
    contribution: { type: String, default: "", maxlength: 2000 },
    technologies: { type: [String], default: [] },
    outcomes: { type: String, default: "", maxlength: 2000 },
    repositoryUrl: { type: String, default: "", maxlength: 2048 },
    demoUrl: { type: String, default: "", maxlength: 2048 },
  },
  { _id: true },
);

const professionalProfileSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, immutable: true },
    revision: { type: Number, required: true, default: 1, min: 1 },
    headline: { type: String, default: "", maxlength: 160 },
    careerSummary: { type: String, default: "", maxlength: 5000 },
    skills: { type: [String], default: [] },
    targetRoles: { type: String, default: "", maxlength: 1000 },
    intendedAudience: { type: String, default: "", maxlength: 1000 },
    projects: { type: [projectSchema], default: [] },
    resumeText: { type: String, default: "", maxlength: 30000 },
  },
  { timestamps: true, versionKey: false, collection: "professionalProfiles" },
);

export type ProfessionalProfileDocument = InferSchemaType<typeof professionalProfileSchema> & {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export const ProfessionalProfileModel = model("ProfessionalProfile", professionalProfileSchema);
