import { model, Schema, type InferSchemaType, type Types } from "mongoose";

const topicSuggestionSchema = new Schema({
  id: { type: String, required: true },
  title: { type: String, required: true, maxlength: 160 },
  angle: { type: String, required: true, maxlength: 1000 },
  relevance: { type: String, required: true, maxlength: 1000 },
  talkingPoints: { type: [String], required: true, maxlength: 8 },
  sourceIds: { type: [String], required: true, maxlength: 5 },
  missingEvidence: { type: [String], required: true, maxlength: 8 },
});

const topicPlanningSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    requestId: { type: String, required: true, maxlength: 100 },
    audience: { type: String, default: "", maxlength: 500 },
    contentGoal: { type: String, default: "", maxlength: 500 },
    sourceVersions: { type: [{ sourceId: String, contentVersion: Number }], required: true },
    suggestions: { type: [topicSuggestionSchema], required: true, default: [] },
    model: { type: String, required: true, maxlength: 200 },
    inputFingerprint: { type: String, required: true, immutable: true },
    status: { type: String, enum: ["running", "succeeded", "failed", "uncertain"], required: true },
    errorCode: { type: String, maxlength: 80, default: null },
    stale: { type: Boolean, default: false },
    convertedSuggestionIds: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false, collection: "topicPlanningRuns" },
);
topicPlanningSchema.index({ ownerId: 1, requestId: 1 }, { unique: true });
topicPlanningSchema.index({ ownerId: 1, createdAt: -1 });

export type TopicPlanningDocument = InferSchemaType<typeof topicPlanningSchema> & {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const TopicPlanningModel = model("TopicPlanningRun", topicPlanningSchema);
