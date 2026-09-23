import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  aiIndexingErrorResponseSchema,
  aiIndexingResponseSchema,
  type AiIndexingResult,
} from "./indexing.types.js";

interface IndexingDiagnostics {
  correlationId: string;
  stage: string;
  httpStatus?: number;
  safeErrorCode?: string;
  elapsedMs?: number;
}

function logIndexingDiagnostic(diag: IndexingDiagnostics): void {
  const diagnostic = `[indexing] ${diag.correlationId} ${diag.stage}${diag.httpStatus ? ` http=${diag.httpStatus}` : ""}${diag.safeErrorCode ? ` error=${diag.safeErrorCode}` : ""}${diag.elapsedMs ? ` elapsed=${diag.elapsedMs}ms` : ""}`;
  console.log(diagnostic);
}

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
    const correlationId = input.sourceId.substring(0, 8);
    const startTime = Date.now();

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
      const elapsedMs = Date.now() - startTime;
      if (controller.signal.aborted) {
        logIndexingDiagnostic({
          correlationId,
          stage: "ai-request-timeout",
          elapsedMs,
        });
        throw new AppError(504, "AI_SERVICE_TIMEOUT", "The AI service timed out");
      }
      logIndexingDiagnostic({
        correlationId,
        stage: "ai-request-unavailable",
        elapsedMs,
      });
      throw new AppError(
        503,
        "AI_SERVICE_UNAVAILABLE",
        "The AI service is unavailable",
      );
    } finally {
      clearTimeout(timeout);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      const elapsedMs = Date.now() - startTime;
      logIndexingDiagnostic({
        correlationId,
        stage: "ai-response-parse",
        httpStatus: response.status,
        elapsedMs,
      });
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
      const elapsedMs = Date.now() - startTime;
      logIndexingDiagnostic({
        correlationId,
        stage: "ai-response-error",
        httpStatus: response.status,
        safeErrorCode: safeCode || "unmapped",
        elapsedMs,
      });
      const status = response.status === 401 ? 503 : response.status === 504 ? 504 : response.status >= 500 ? 503 : 502;
      throw new AppError(status, safeCode || "AI_SERVICE_ERROR", "The AI indexing request failed");
    }
    const parsed = aiIndexingResponseSchema.safeParse(body);
    if (!parsed.success) {
      const elapsedMs = Date.now() - startTime;
      logIndexingDiagnostic({
        correlationId,
        stage: "ai-response-invalid",
        httpStatus: response.status,
        elapsedMs,
      });
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    }
    const elapsedMs = Date.now() - startTime;
    logIndexingDiagnostic({
      correlationId,
      stage: "ai-response-success",
      httpStatus: response.status,
      elapsedMs,
    });
    return { ...parsed.data.data, usage: parsed.data.usage };
  }
}

export const aiIndexingClient: AiIndexingClient = new AiIndexingServiceClient();
