import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { AppError } from "../src/errors/app-error.js";
import {
  indexKnowledgeSourceForUser,
  type IndexingRepository,
} from "../src/services/knowledge-source-indexing.service.js";
import { deleteKnowledgeSourceForUser } from "../src/services/knowledge-source.service.js";

const ownerId = "507f1f77bcf86cd799439011";
const sourceId = "507f1f77bcf86cd799439012";
const timestamp = new Date("2030-01-01T00:00:00.000Z");

function source(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(sourceId),
    ownerId: new Types.ObjectId(ownerId),
    title: "Architecture notes",
    content: "A sufficiently long source note for indexing.",
    contentVersion: 1,
    processingStatus: "pending" as const,
    processingErrorCode: null,
    indexingAttemptId: null,
    indexingLeaseExpiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function repositoryWith(
  current: ReturnType<typeof source> | null,
  overrides: Partial<IndexingRepository> = {},
): IndexingRepository {
  return {
    findKnowledgeSourceForIndexing: async () => current,
    claimKnowledgeSourceIndexing: async (_owner, _source, _version, attempt) =>
      source({ processingStatus: "indexing", indexingAttemptId: attempt }),
    finalizeKnowledgeSourceIndexing: async () => source({ processingStatus: "indexed" }),
    ...overrides,
  };
}

function validResult() {
  return {
    sourceId,
    contentVersion: 1,
    chunkerVersion: "chunker-v1",
    embeddingModel: "text-embedding-3-small",
    dimensions: 1536,
    indexedChunkCount: 1,
  };
}

function lifecycleRepository(initial = source(), now: () => Date = () => new Date()) {
  let current = initial;
  return {
    get current() {
      return current;
    },
    repository: {
      findKnowledgeSourceForIndexing: async () => current,
      claimKnowledgeSourceIndexing: async (
        _owner: string,
        _source: string,
        _version: number,
        attemptId: string,
        leaseExpiresAt: Date,
      ) => {
        if (
          (current.processingStatus === "indexing" ||
            current.processingStatus === "failed") &&
          current.indexingLeaseExpiresAt &&
          current.indexingLeaseExpiresAt > now()
        ) {
          return null;
        }
        current = source({
          processingStatus: "indexing",
          indexingAttemptId: attemptId,
          indexingLeaseExpiresAt: leaseExpiresAt,
        });
        return current;
      },
      finalizeKnowledgeSourceIndexing: async (
        _owner: string,
        _source: string,
        _version: number,
        attemptId: string,
        status: "indexed" | "failed",
        errorCode: string | null,
        metadata?: {
          indexedContentVersion: number;
          indexedChunkerVersion: string;
          indexedEmbeddingModel: string;
          indexedDimensions: number;
          indexedChunkCount: number;
        },
        retainLease = false,
      ) => {
        if (
          current.processingStatus !== "indexing" ||
          current.indexingAttemptId !== attemptId
        ) {
          return null;
        }
        current = source({
          ...current,
          processingStatus: status,
          processingErrorCode: errorCode,
          ...(metadata ?? {}),
          ...(retainLease
            ? {}
            : { indexingAttemptId: null, indexingLeaseExpiresAt: null }),
        });
        return current;
      },
    } satisfies IndexingRepository,
  };
}

test("reuses an indexed source version without calling the AI service", async () => {
  let calls = 0;
  const result = await indexKnowledgeSourceForUser(
    ownerId,
    sourceId,
    {
      index: async () => {
        calls += 1;
        throw new Error("must not call");
      },
    },
    repositoryWith(
      source({
        processingStatus: "indexed",
        indexedContentVersion: 1,
        indexedChunkerVersion: "chunker-v1",
        indexedEmbeddingModel: "text-embedding-3-small",
        indexedDimensions: 1536,
        indexedChunkCount: 1,
      }),
    ),
  );

  assert.equal(result.processingStatus, "indexed");
  assert.equal(calls, 0);
});

test("claims, indexes, and finalizes with source-owned content", async () => {
  const calls: unknown[] = [];
  const repository = repositoryWith(source(), {
    claimKnowledgeSourceIndexing: async (...args) => {
      calls.push(["claim", ...args]);
      return source({ processingStatus: "indexing", indexingAttemptId: args[3] });
    },
    finalizeKnowledgeSourceIndexing: async (...args) => {
      calls.push(["finalize", ...args]);
      return source({ processingStatus: "indexed" });
    },
  });
  const client = {
    index: async (input: {
      ownerId: string;
      sourceId: string;
      contentVersion: number;
      content: string;
    }) => {
      calls.push(["ai", input]);
      return {
        sourceId,
        contentVersion: 1,
        chunkerVersion: "chunker-v1",
        embeddingModel: "text-embedding-3-small",
        dimensions: 1536,
        indexedChunkCount: 1,
      };
    },
  };

  const result = await indexKnowledgeSourceForUser(ownerId, sourceId, client, repository);

  assert.equal(result.processingStatus, "indexed");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], [
    "ai",
    {
      ownerId,
      sourceId,
      contentVersion: 1,
      content: "A sufficiently long source note for indexing.",
    },
  ]);
});

test("does not report success when finalization is stale", async () => {
  const repository = repositoryWith(source(), {
    finalizeKnowledgeSourceIndexing: async () => null,
  });
  const client = {
    index: async () => validResult(),
  };

  await assert.rejects(
    indexKnowledgeSourceForUser(ownerId, sourceId, client, repository),
    (error: unknown) =>
      error instanceof AppError && error.code === "SOURCE_INDEXING_STALE",
  );
});

test("uncertain timeout keeps retry and deletion blocked until lease expiry", async () => {
    const clock = { now: new Date("2030-01-01T00:00:00.000Z") };
    const lifecycle = lifecycleRepository(source(), () => clock.now);
    let clientCalls = 0;
    const timeoutClient = {
      index: async () => {
        clientCalls += 1;
        throw new AppError(504, "AI_SERVICE_TIMEOUT", "The AI service timed out");
      },
    };

    await assert.rejects(
      indexKnowledgeSourceForUser(
        ownerId,
        sourceId,
        timeoutClient,
        lifecycle.repository,
        () => clock.now,
      ),
      (error: unknown) => error instanceof AppError && error.code === "AI_SERVICE_TIMEOUT",
    );
    assert.equal(lifecycle.current.processingStatus, "failed");
    assert.ok(lifecycle.current.indexingLeaseExpiresAt);

    await assert.rejects(
      indexKnowledgeSourceForUser(
        ownerId,
        sourceId,
        timeoutClient,
        lifecycle.repository,
        () => clock.now,
      ),
      (error: unknown) =>
        error instanceof AppError && error.code === "SOURCE_INDEXING_IN_PROGRESS",
    );
    await assert.rejects(
      deleteKnowledgeSourceForUser(ownerId, sourceId, {
        createKnowledgeSource: async () => lifecycle.current,
        findKnowledgeSourcesByOwner: async () => [],
        countKnowledgeSourcesByOwner: async () => 0,
        findKnowledgeSourceByIdAndOwner: async () => lifecycle.current,
        deleteKnowledgeSourceByIdAndOwner: async () => lifecycle.current,
        deleteKnowledgeSourceByIdAndOwnerIfNotIndexing: async () => null,
        findKnowledgeSourceForIndexing: async () => lifecycle.current,
        claimKnowledgeSourceIndexing: lifecycle.repository.claimKnowledgeSourceIndexing,
        finalizeKnowledgeSourceIndexing: lifecycle.repository.finalizeKnowledgeSourceIndexing,
      }),
      (error: unknown) =>
        error instanceof AppError && error.code === "SOURCE_INDEXING_IN_PROGRESS",
    );
    assert.equal(clientCalls, 1);
  });

test("expired lease permits an explicit retry", async () => {
    const clock = { now: new Date("2030-01-01T00:00:00.000Z") };
    const lifecycle = lifecycleRepository(source(), () => clock.now);
    const client = { index: async () => validResult() };

    await assert.rejects(
      indexKnowledgeSourceForUser(
        ownerId,
        sourceId,
        {
          index: async () => {
            throw new AppError(503, "AI_SERVICE_UNAVAILABLE", "The AI service is unavailable");
          },
        },
        lifecycle.repository,
        () => clock.now,
      ),
    );
    clock.now = new Date("2030-01-01T01:00:00.000Z");
    const result = await indexKnowledgeSourceForUser(
      ownerId,
      sourceId,
      client,
      lifecycle.repository,
      () => clock.now,
    );
    assert.equal(result.processingStatus, "indexed");
  });

test("an older attempt cannot finalize over a newer attempt", async () => {
    const clock = { now: new Date("2030-01-01T00:00:00.000Z") };
    const lifecycle = lifecycleRepository(source(), () => clock.now);
    let releaseFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const client = {
      index: async () => {
        calls += 1;
        if (calls === 1) {
          await firstFinished;
        }
        return validResult();
      },
    };

    const first = indexKnowledgeSourceForUser(
      ownerId,
      sourceId,
      client,
      lifecycle.repository,
      () => clock.now,
    );
    await new Promise((resolve) => setImmediate(resolve));
    clock.now = new Date("2030-01-01T01:00:00.000Z");
    const second = await indexKnowledgeSourceForUser(
      ownerId,
      sourceId,
      client,
      lifecycle.repository,
      () => clock.now,
    );
    releaseFirst();
    await assert.rejects(
      first,
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_INDEXING_STALE",
    );
    assert.equal(second.processingStatus, "indexed");
    assert.equal(lifecycle.current.processingStatus, "indexed");
  });

test("invalid AI metadata cannot mark the source indexed", async () => {
    for (const result of [
      { ...validResult(), sourceId: "507f1f77bcf86cd799439099" },
      { ...validResult(), contentVersion: 2 },
      { ...validResult(), dimensions: 0 },
      { ...validResult(), indexedChunkCount: 0 },
    ]) {
      const lifecycle = lifecycleRepository();
      await assert.rejects(
        indexKnowledgeSourceForUser(
          ownerId,
          sourceId,
          { index: async () => result },
          lifecycle.repository,
          () => new Date("2030-01-01T00:00:00.000Z"),
        ),
        (error: unknown) => error instanceof AppError && error.code === "AI_INVALID_RESPONSE",
      );
      assert.notEqual(lifecycle.current.processingStatus, "indexed");
    }
  });

test("missing or cross-owner sources do not call the AI client", async () => {
    let calls = 0;
    const client = {
      index: async () => {
        calls += 1;
        return validResult();
      },
    };
    const repository: IndexingRepository = {
      findKnowledgeSourceForIndexing: async () => null,
      claimKnowledgeSourceIndexing: async () => null,
      finalizeKnowledgeSourceIndexing: async () => null,
    };

    await assert.rejects(
      indexKnowledgeSourceForUser(ownerId, sourceId, client, repository),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_NOT_FOUND",
    );
    await assert.rejects(
      indexKnowledgeSourceForUser("507f1f77bcf86cd799439099", sourceId, client, repository),
      (error: unknown) => error instanceof AppError && error.code === "SOURCE_NOT_FOUND",
    );
    assert.equal(calls, 0);
});

test("diagnostic logs redact sensitive data", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(String(args[0]));
    };

    try {
      const repository = repositoryWith(source(), {
        finalizeKnowledgeSourceIndexing: async () =>
          source({ processingStatus: "indexed" }),
      });
      const client = {
        index: async () => ({
          sourceId,
          contentVersion: 1,
          chunkerVersion: "chunker-v1",
          embeddingModel: "text-embedding-3-small",
          dimensions: 1536,
          indexedChunkCount: 42,
        }),
      };

      await indexKnowledgeSourceForUser(ownerId, sourceId, client, repository);

      assert(logs.length > 0, "Expected diagnostic logs");
      for (const log of logs) {
        // All logs should start with [indexing]
        assert(log.includes("[indexing]"), `Log should contain [indexing]: ${log}`);
        // Logs should contain only safe fields: correlation-id (first 8 chars of sourceId),
        // stage, http status, error code, elapsed time
        assert(
          !/content|password|secret|key|vector|embedding|model/.test(log),
          `Log contains potentially sensitive field: ${log}`,
        );
        // Should not contain full source or owner IDs
        assert(
          !log.includes(ownerId),
          `Log should not contain ownerId: ${log}`,
        );
        // Correlation ID should be first 8 chars of sourceId
        const correlationId = sourceId.substring(0, 8);
        if (log.includes(correlationId)) {
          assert(
            log.split(correlationId).length > 1,
            `Correlation ID found in log: ${log}`,
          );
        }
      }
    } finally {
      console.log = originalLog;
    }
  });
