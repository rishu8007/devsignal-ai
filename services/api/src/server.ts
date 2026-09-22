import type { Server } from "node:http";
import { app } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { ensureGenerationIndexes } from "./repositories/generation.repository.js";
import { ensureResearchBriefIndexes } from "./repositories/research-brief.repository.js";
import { ensureDraftReviewIndexes } from "./repositories/draft-review.repository.js";
import { ensureContentWorkflowIndexes } from "./repositories/content-workflow.repository.js";
import { startContentWorkflowWorker } from "./services/content-workflow.service.js";
import { ensureLinkedInIndexes } from "./repositories/linkedin.repository.js";
import { startLinkedInSchedulerWorker } from "./services/linkedin-publication.service.js";
import { startNotificationReconciliationWorker } from "./services/notification.service.js";
import { ensureNotificationIndexes } from "./repositories/notification.repository.js";

let server: Server | undefined;
let stopWorkflowWorker: (() => void) | undefined;
let stopLinkedInScheduler: (() => void | Promise<void>) | undefined;
let stopNotificationWorker: (() => void | Promise<void>) | undefined;
let isShuttingDown = false;

async function closeHttpServer(): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully.`);

  try {
    stopWorkflowWorker?.();
    await stopLinkedInScheduler?.();
    await stopNotificationWorker?.();
    await closeHttpServer();
    await disconnectFromDatabase();
    process.exitCode = 0;
  } catch {
    console.error("Graceful shutdown failed.");
    process.exitCode = 1;
  }
}

async function startServer(): Promise<void> {
  try {
    await connectToDatabase();
    await ensureGenerationIndexes();
    await ensureResearchBriefIndexes();
    await ensureDraftReviewIndexes();
    await ensureContentWorkflowIndexes();
    await ensureLinkedInIndexes();
    await ensureNotificationIndexes();
  } catch {
    console.error("Database connection failed; the API server was not started.");
    process.exitCode = 1;
    return;
  }

  server = app.listen(env.PORT, () => {
    console.log(`DevSignal API listening on port ${env.PORT}`);
  });
  stopWorkflowWorker = startContentWorkflowWorker();
  stopLinkedInScheduler = startLinkedInSchedulerWorker();
  stopNotificationWorker = startNotificationReconciliationWorker();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void startServer();
