import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  aiIndexingErrorResponseSchema,
  aiIndexingResponseSchema,
  type AiIndexingResult,
} from "./indexing.types.js";

export interface AiIndexingClient {
  index(input: {
    ownerId: string;
    sourceId: string;
    contentVersion: number;
    content: string;
  }): Promise<AiIndexingResult>;
}

export class AiIndexingServiceClient implements AiIndexingClient {
  public constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs: number = env.AI_SERVICE_TIMEOUT_MS,
    private readonly internalApiKey: string | undefined = env.AI_INTERNAL_API_KEY,
  ) {}

  public async index(input: {
    ownerId: string;
    sourceId: string;
    contentVersion: number;
    content: string;
  }): Promise<AiIndexingResult> {
    if (!this.internalApiKey) {
      throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/indexings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-API-Key": this.internalApiKey,
        },
        body: JSON.stringify(input),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new AppError(
        controller.signal.aborted ? 504 : 503,
        controller.signal.aborted ? "AI_SERVICE_TIMEOUT" : "AI_SERVICE_UNAVAILABLE",
        controller.signal.aborted ? "The AI service timed out" : "The AI service is unavailable",
      );
    } finally {
      clearTimeout(timeout);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    }
    if (!response.ok) {
      const parsedError = aiIndexingErrorResponseSchema.safeParse(body);
      const upstreamCode = parsedError.success ? parsedError.data.error.code : "";
      const safeCodes = new Set([
        "INDEXING_STORAGE_INCOMPATIBLE",
        "INDEXING_UNAVAILABLE",
        "INDEXING_TIMEOUT",
        "INDEXING_PROVIDER_BUSY",
        "INDEXING_INVALID_EMBEDDING",
        "VALIDATION_ERROR",
        "INDEXING_FAILED",
      ]);
      const safeCode = safeCodes.has(upstreamCode) ? upstreamCode : "";
      const status = response.status === 401 ? 503 : response.status === 504 ? 504 : response.status >= 500 ? 503 : 502;
      throw new AppError(status, safeCode || "AI_SERVICE_ERROR", "The AI indexing request failed");
    }
    const parsed = aiIndexingResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    }
    return parsed.data.data;
  }
}

export const aiIndexingClient: AiIndexingClient = new AiIndexingServiceClient();
