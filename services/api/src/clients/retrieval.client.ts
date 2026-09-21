import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  aiRetrievalErrorResponseSchema,
  aiRetrievalResponseSchema,
  type AiRetrievalCandidate,
} from "./retrieval.types.js";

export interface AiRetrievalClient {
  retrieve(input: {
    ownerId: string;
    query: string;
    limit: number;
    sourceIds?: string[];
    researchOnly?: boolean;
  }): Promise<AiRetrievalCandidate[]>;
}

export class AiRetrievalServiceClient implements AiRetrievalClient {
  public constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs: number = env.AI_SERVICE_TIMEOUT_MS,
    private readonly internalApiKey: string | undefined = env.AI_INTERNAL_API_KEY,
  ) {}

  public async retrieve(input: {
    ownerId: string;
    query: string;
    limit: number;
    sourceIds?: string[];
    researchOnly?: boolean;
  }): Promise<AiRetrievalCandidate[]> {
    if (!this.internalApiKey) {
      throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const { researchOnly = false, ...requestBody } = input;
    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/${researchOnly ? "research-retrievals" : "retrievals"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-API-Key": this.internalApiKey,
        },
        body: JSON.stringify(requestBody),
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

    const body = await readJson(response);
    if (!response.ok) {
      throw mapRetrievalError(response.status, body);
    }
    const parsed = aiRetrievalResponseSchema.safeParse(body);
    if (!parsed.success || parsed.data.data.length > input.limit) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
    }
    return parsed.data.data;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
  }
}

function mapRetrievalError(status: number, body: unknown): AppError {
  const parsed = aiRetrievalErrorResponseSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : "";
  if (code === "RETRIEVAL_COLLECTION_MISSING") {
    return new AppError(
      503,
      "KNOWLEDGE_RETRIEVAL_COLLECTION_MISSING",
      "Knowledge retrieval has not been initialized",
    );
  }
  if (code === "RETRIEVAL_TIMEOUT" || status === 504) {
    return new AppError(504, "AI_SERVICE_TIMEOUT", "The AI service timed out");
  }
  if (code === "RETRIEVAL_INVALID_RESPONSE" || code === "RETRIEVAL_INVALID_EMBEDDING") {
    return new AppError(502, "AI_INVALID_RESPONSE", "The AI service returned an invalid response");
  }
  if (code === "RETRIEVAL_UNAVAILABLE") {
    return new AppError(503, "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", "Knowledge retrieval is unavailable");
  }
  if (status >= 500) {
    return new AppError(503, "KNOWLEDGE_RETRIEVAL_UNAVAILABLE", "Knowledge retrieval is unavailable");
  }
  return new AppError(502, "AI_SERVICE_ERROR", "The AI retrieval request failed");
}

export const aiRetrievalClient: AiRetrievalClient = new AiRetrievalServiceClient();
