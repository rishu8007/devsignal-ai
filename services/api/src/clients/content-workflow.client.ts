import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { z } from "zod";

const usageSchema = z.object({
  model: z.string(),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  embeddingTokens: z.number().int().nonnegative().nullable().optional(),
});
const responseSchema = z.object({ success: z.literal(true), data: z.object({ status: z.string(), phase: z.string(), state: z.record(z.string(), z.unknown()), interrupt: z.unknown().optional(), usage: usageSchema.nullable().optional() }) });
export type WorkflowAiResult = z.infer<typeof responseSchema>["data"];
export interface ContentWorkflowClient {
  advance(input: Record<string, unknown>): Promise<WorkflowAiResult>;
}
export class AiContentWorkflowClient implements ContentWorkflowClient {
  constructor(private readonly fetchImplementation: typeof fetch = fetch, private readonly timeoutMs = env.AI_SERVICE_TIMEOUT_MS, private readonly internalApiKey = env.AI_INTERNAL_API_KEY) {}
  async advance(input: Record<string, unknown>): Promise<WorkflowAiResult> {
    if (!this.internalApiKey) throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/workflows`, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-API-Key": this.internalApiKey }, body: JSON.stringify(input), redirect: "error", signal: controller.signal });
    } catch {
      throw new AppError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "AI_SERVICE_TIMEOUT" : "AI_SERVICE_UNAVAILABLE", controller.signal.aborted ? "The AI service timed out" : "The AI service is unavailable");
    } finally {
      clearTimeout(timeout);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response"); }
    if (!response.ok) throw new AppError(response.status >= 500 ? 503 : 502, "AI_SERVICE_ERROR", "The AI workflow request failed");
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid workflow response");
    return parsed.data.data;
  }
}
export const aiContentWorkflowClient: ContentWorkflowClient = new AiContentWorkflowClient();
