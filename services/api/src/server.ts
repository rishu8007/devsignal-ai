import { app } from "./app.js";
import { env } from "./config/env.js";

const server = app.listen(env.PORT, () => {
  console.log(`DevSignal API listening on port ${env.PORT}`);
});

let isShuttingDown = false;

function shutdown(signal: string): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}; shutting down gracefully.`);
  server.close((error?: Error) => {
    if (error) {
      console.error("Graceful shutdown failed.");
      process.exitCode = 1;
      return;
    }

    process.exitCode = 0;
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
