import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const linkedinOauthStateSchema = new Schema(
  {
    stateHash: { type: String, required: true, unique: true, immutable: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    sessionHash: { type: String, required: true, immutable: true },
    codeVerifierEncrypted: { type: String, required: true, immutable: true },
    returnPath: { type: String, required: true, immutable: true },
    connectionGeneration: { type: Number, required: true, immutable: true, default: 0 },
    expiresAt: { type: Date, required: true, immutable: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "linkedinOauthStates" },
);

linkedinOauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
linkedinOauthStateSchema.index({ stateHash: 1, sessionHash: 1, usedAt: 1 });

export type LinkedInOauthStateDocument = InferSchemaType<typeof linkedinOauthStateSchema> & {
  _id: Types.ObjectId;
};

export const LinkedInOauthStateModel = model("LinkedInOauthState", linkedinOauthStateSchema);
