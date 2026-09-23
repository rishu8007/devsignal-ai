import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { z } from "zod";

const findingSchema = z.object({
  category: z.enum(["unsupported_personal_claim", "unsupported_technical_claim", "contradiction", "overstatement", "clarity"]),
  severity: z.enum(["low", "medium", "high"]),
  passage: z.string().min(1).max(1000),
  explanation: z.string().min(1).max(1200),
  evidenceIds: z.array(z.string()).max(8),
  suggestion: z.string().min(1).max(1000),
});
const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    model: z.string(),
    summary: z.string().max(1500),
    findings: z.array(findingSchema).max(12),
    proposedDraft: z.string().max(3000).nullable(),
  }),
  usage: z.object({ model: z.string(), inputTokens: z.number().int().nonnegative().nullable().optional(), outputTokens: z.number().int().nonnegative().nullable().optional(), embeddingTokens: z.number().int().nonnegative().nullable().optional() }).nullable().optional(),
});
export type DraftReviewResult = z.infer<typeof responseSchema>["data"] & { usage?: { model: string; inputTokens: number | null; outputTokens: number | null; embeddingTokens: number | null } | undefined };
export interface DraftReviewClient {
  review(input: { draft: string; evidence: Array<{ evidenceId: string; text: string }> }): Promise<DraftReviewResult>;
}
export class AiDraftReviewClient implements DraftReviewClient {
  constructor(private readonly fetchImplementation: typeof fetch = fetch, private readonly timeoutMs = env.AI_SERVICE_TIMEOUT_MS, private readonly internalApiKey = env.AI_INTERNAL_API_KEY) {}
  async review(input: { draft: string; evidence: Array<{ evidenceId: string; text: string }> }): Promise<DraftReviewResult> {
    if (!this.internalApiKey) throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/draft-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-API-Key": this.internalApiKey },
        body: JSON.stringify(input),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new AppError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "AI_SERVICE_TIMEOUT" : "AI_SERVICE_UNAVAILABLE", controller.signal.aborted ? "The AI service timed out" : "The AI service is unavailable");
    } finally {
      clearTimeout(timeout);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response"); }
    if (!response.ok) throw new AppError(response.status >= 500 ? 503 : 502, response.status === 429 ? "AI_PROVIDER_RATE_LIMITED" : "AI_SERVICE_ERROR", "The AI review request failed");
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    return { ...parsed.data.data, usage: parsed.data.usage ? { model: parsed.data.usage.model, inputTokens: parsed.data.usage.inputTokens ?? null, outputTokens: parsed.data.usage.outputTokens ?? null, embeddingTokens: parsed.data.usage.embeddingTokens ?? null } : undefined };
  }
}
export const aiDraftReviewClient: DraftReviewClient = new AiDraftReviewClient();
