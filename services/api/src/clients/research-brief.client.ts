import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { z } from "zod";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    model: z.string(),
    noEvidence: z.boolean(),
    topicSummary: z.string(),
    talkingPoints: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) })),
    claimAssessments: z.array(z.object({ claim: z.string(), assessment: z.enum(["supported", "partially_supported", "unsupported", "conflicting"]), explanation: z.string(), evidenceIds: z.array(z.string()) })),
    missingInformation: z.array(z.string()),
    questions: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
});
export type ResearchBriefEvidence = {
  evidenceId: string;
  sourceId: string;
  title: string;
  contentVersion: number;
  chunkId: string;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  score: number;
};
export type ResearchBriefResult = z.infer<typeof responseSchema>["data"];
export interface ResearchBriefClient { research(input: { topic: string; notes: string; evidence: ResearchBriefEvidence[] }): Promise<ResearchBriefResult>; }
export class AiResearchBriefClient implements ResearchBriefClient {
  constructor(private readonly fetchImplementation: typeof fetch = fetch, private readonly timeoutMs = env.AI_SERVICE_TIMEOUT_MS, private readonly internalApiKey = env.AI_INTERNAL_API_KEY) {}
  async research(input: { topic: string; notes: string; evidence: ResearchBriefEvidence[] }): Promise<ResearchBriefResult> {
    if (!this.internalApiKey) throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/research-briefs`, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-API-Key": this.internalApiKey }, body: JSON.stringify(input), redirect: "error", signal: controller.signal });
    } catch { throw new AppError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "AI_SERVICE_TIMEOUT" : "AI_SERVICE_UNAVAILABLE", controller.signal.aborted ? "The AI service timed out" : "The AI service is unavailable"); } finally { clearTimeout(timeout); }
    let body: unknown; try { body = await response.json(); } catch { throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response"); }
    if (!response.ok) throw new AppError(response.status >= 500 ? 503 : 502, response.status === 429 ? "AI_PROVIDER_RATE_LIMITED" : "AI_SERVICE_ERROR", "The AI research request failed");
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    return parsed.data.data;
  }
}
export const aiResearchBriefClient: ResearchBriefClient = new AiResearchBriefClient();
