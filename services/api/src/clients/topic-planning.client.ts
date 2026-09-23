import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { z } from "zod";

const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    model: z.string(),
    suggestions: z.array(z.object({
      id: z.string(), title: z.string(), angle: z.string(), relevance: z.string(),
      talkingPoints: z.array(z.string()), sourceIds: z.array(z.string()), missingEvidence: z.array(z.string()),
    })).min(3).max(5),
  }),
  usage: z.object({ model: z.string(), inputTokens: z.number().int().nonnegative().nullable().optional(), outputTokens: z.number().int().nonnegative().nullable().optional(), embeddingTokens: z.number().int().nonnegative().nullable().optional() }).nullable().optional(),
});
export type TopicPlanningSource = { sourceId: string; contentVersion: number; title: string; text: string };
export type TopicPlanningResult = z.infer<typeof responseSchema>["data"] & { usage?: { model: string; inputTokens: number | null; outputTokens: number | null; embeddingTokens: number | null } | undefined };
export interface TopicPlanningClient { plan(input: { audience: string; contentGoal: string; sources: TopicPlanningSource[] }): Promise<TopicPlanningResult>; }

export class AiTopicPlanningClient implements TopicPlanningClient {
  constructor(private readonly fetchImplementation: typeof fetch = fetch, private readonly timeoutMs = env.AI_SERVICE_TIMEOUT_MS, private readonly internalApiKey = env.AI_INTERNAL_API_KEY) {}
  async plan(input: { audience: string; contentGoal: string; sources: TopicPlanningSource[] }): Promise<TopicPlanningResult> {
    if (!this.internalApiKey) throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/topic-plans`, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-API-Key": this.internalApiKey }, body: JSON.stringify(input), redirect: "error", signal: controller.signal });
    } catch { throw new AppError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "AI_SERVICE_TIMEOUT" : "AI_SERVICE_UNAVAILABLE", controller.signal.aborted ? "The AI service timed out" : "The AI service is unavailable"); } finally { clearTimeout(timer); }
    let body: unknown; try { body = await response.json(); } catch { throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response"); }
    if (!response.ok) throw new AppError(response.status >= 500 ? 503 : 502, response.status === 429 ? "AI_PROVIDER_RATE_LIMITED" : "AI_SERVICE_ERROR", "The AI planning request failed");
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    return { ...parsed.data.data, usage: parsed.data.usage ? { model: parsed.data.usage.model, inputTokens: parsed.data.usage.inputTokens ?? null, outputTokens: parsed.data.usage.outputTokens ?? null, embeddingTokens: parsed.data.usage.embeddingTokens ?? null } : undefined };
  }
}
export const aiTopicPlanningClient: TopicPlanningClient = new AiTopicPlanningClient();
