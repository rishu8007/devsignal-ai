import { connectToDatabase, disconnectFromDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { ensureGithubIndexes, listGithubConnections } from "./repositories/github.repository.js";
import { syncGithubActivities } from "./services/github-connection.service.js";

const intervalMs = env.GITHUB_SYNC_INTERVAL_MINUTES * 60 * 1000;
async function run() {
  await connectToDatabase();
  await ensureGithubIndexes();
  const connections = await listGithubConnections();
  for (const connection of connections) {
    try { await syncGithubActivities(connection.ownerId.toString()); } catch (error) { console.error("[github-sync] connection failed", error instanceof Error ? error.message : "unknown error"); }
  }
}
if (!env.GITHUB_SYNC_ENABLED) {
  console.info("[github-sync] disabled");
  process.exit(0);
}
let running = true;
const timer = setInterval(() => {
  if (running) void run().catch((error) => console.error("[github-sync] run failed", error instanceof Error ? error.message : "unknown error"));
}, intervalMs);
await run();
async function shutdown() {
  running = false;
  clearInterval(timer);
  await disconnectFromDatabase();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
