import { connectToDatabase, disconnectFromDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { ensureLinkedInIndexes } from "./repositories/linkedin.repository.js";
import { startLinkedInSchedulerWorker } from "./services/linkedin-publication.service.js";

let stop: (() => void | Promise<void>) | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping LinkedIn scheduler worker.`);
  await stop?.();
  await disconnectFromDatabase();
}

async function start(): Promise<void> {
  if (!env.LINKEDIN_SCHEDULER_ENABLED) {
    console.log("LinkedIn scheduler is disabled; worker will not start.");
    return;
  }
  await connectToDatabase();
  await ensureLinkedInIndexes();
  stop = startLinkedInSchedulerWorker();
  console.log("LinkedIn scheduler worker started.");
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch(async () => {
  console.error("LinkedIn scheduler worker failed to start.");
  await disconnectFromDatabase();
  process.exitCode = 1;
});
