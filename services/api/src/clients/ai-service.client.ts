import { env } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import {
  aiErrorResponseSchema,
  aiGenerationResponseSchema,
} from "../validation/generation.validation.js";
import {
  GENERATION_ANGLES,
  type AiGenerationResult,
  type GenerationContextChunk,
  type GenerationSource,
} from "../types/generation.js";

export interface AiGenerationClient {
  generate(source: GenerationSource, context?: GenerationContextChunk[]): Promise<AiGenerationResult>;
}

export class AiServiceClient implements AiGenerationClient {
  public constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs: number = env.AI_SERVICE_TIMEOUT_MS,
    private readonly internalApiKey: string | undefined = env.AI_INTERNAL_API_KEY,
  ) {}

  public async generate(
    source: GenerationSource,
    context?: GenerationContextChunk[],
  ): Promise<AiGenerationResult> {
    if (!this.internalApiKey) {
      throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImplementation(`${env.AI_SERVICE_URL}/api/v1/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-API-Key": this.internalApiKey,
        },
        // The context field is only included on the wire when non-empty, so an
        // ungrounded request produces the exact same request body as before this
        // feature existed.
        body: JSON.stringify(
          context && context.length > 0 ? { ...source, context } : source,
        ),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError(504, "AI_SERVICE_TIMEOUT", "The AI service timed out");
      }

      throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
    } finally {
      clearTimeout(timeout);
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapUpstreamError(response.status, body);
    }

    const parsed = aiGenerationResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
    }

    const byAngle = new Map<
      (typeof GENERATION_ANGLES)[number],
      { angle: (typeof GENERATION_ANGLES)[number]; content: string; citations: string[] }
    >();
    for (const variation of parsed.data.data.variations) {
      const content = variation.content.trim();
      const citations = [...new Set(variation.citations)];
      if (
        !content ||
        content.length < 100 ||
        content.length > 3000 ||
        byAngle.has(variation.angle) ||
        citations.length !== variation.citations.length
      ) {
        throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
      }
      byAngle.set(variation.angle, { angle: variation.angle, content, citations });
    }

    if (byAngle.size !== GENERATION_ANGLES.length || GENERATION_ANGLES.some((angle) => !byAngle.has(angle))) {
      throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
    }

    return {
      model: parsed.data.data.model,
      usage: parsed.data.usage ? {
        model: parsed.data.usage.model,
        inputTokens: parsed.data.usage.inputTokens ?? null,
        outputTokens: parsed.data.usage.outputTokens ?? null,
        embeddingTokens: parsed.data.usage.embeddingTokens ?? null,
      } : undefined,
      variations: GENERATION_ANGLES.map((angle) => {
        const variation = byAngle.get(angle);
        if (!variation) {
          throw new AppError(
            502,
            "AI_INVALID_RESPONSE",
            "The AI provider returned an invalid response",
          );
        }
        return variation;
      }),
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AppError(502, "AI_INVALID_RESPONSE", "The AI provider returned an invalid response");
  }
}

function mapUpstreamError(status: number, body: unknown): AppError {
  const code = aiErrorResponseSchema.safeParse(body).success
    ? aiErrorResponseSchema.parse(body).error.code
    : "";
  const mappings: Record<string, AppError> = {
    SERVICE_AUTHENTICATION_REQUIRED: new AppError(
      503,
      "AI_SERVICE_UNAVAILABLE",
      "The AI service is unavailable",
    ),
    AI_GENERATION_REFUSED: new AppError(
      422,
      "AI_GENERATION_REFUSED",
      "The requested content could not be generated",
    ),
    AI_PROVIDER_RATE_LIMITED: new AppError(
      503,
      "AI_PROVIDER_RATE_LIMITED",
      "The AI service is temporarily busy",
    ),
    AI_PROVIDER_TIMEOUT: new AppError(504, "AI_PROVIDER_TIMEOUT", "The AI provider timed out"),
    AI_INVALID_RESPONSE: new AppError(
      502,
      "AI_INVALID_RESPONSE",
      "The AI provider returned an invalid response",
    ),
  };

  return (
    (status === 401
      ? new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable")
      : undefined) ??
    mappings[code] ??
    (status === 503
      ? new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable")
      : new AppError(502, "AI_SERVICE_ERROR", "The AI provider request failed"))
  );
}

export const aiServiceClient: AiGenerationClient = new AiServiceClient();
