import type { Server } from "node:http";
import { app } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { ensureGenerationIndexes } from "./repositories/generation.repository.js";

let server: Server | undefined;
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
  } catch {
    console.error("Database connection failed; the API server was not started.");
    process.exitCode = 1;
    return;
  }

  server = app.listen(env.PORT, () => {
    console.log(`DevSignal API listening on port ${env.PORT}`);
  });
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void startServer();
