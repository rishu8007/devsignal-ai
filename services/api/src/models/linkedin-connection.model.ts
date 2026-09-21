import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const linkedinConnectionSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    providerMemberId: { type: String, required: true, immutable: true },
    displayName: { type: String, default: null, maxlength: 200 },
    email: { type: String, default: null, maxlength: 320 },
    accessTokenEncrypted: { type: String, default: null },
    refreshTokenEncrypted: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    grantedScopes: { type: [String], required: true, default: [] },
    capabilities: {
      identity: { type: Boolean, required: true, default: true },
      posting: { type: Boolean, required: true, default: false },
    },
    status: { type: String, enum: ["connected", "reconnect_required"], required: true, default: "connected" },
    connectionGeneration: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, versionKey: false, collection: "linkedinConnections" },
);

linkedinConnectionSchema.index({ ownerId: 1 }, { unique: true });
linkedinConnectionSchema.index({ providerMemberId: 1 }, { unique: true });

export type LinkedInConnectionDocument = InferSchemaType<typeof linkedinConnectionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const LinkedInConnectionModel = model("LinkedInConnection", linkedinConnectionSchema);
