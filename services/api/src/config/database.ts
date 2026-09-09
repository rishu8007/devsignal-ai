import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("bufferCommands", false);

let connectionAttempt: Promise<void> | null = null;

export type DatabaseStatus =
  | "connected"
  | "connecting"
  | "disconnecting"
  | "disconnected";

export async function connectToDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (connectionAttempt) {
    return connectionAttempt;
  }

  connectionAttempt = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      bufferCommands: false,
    })
    .then(() => undefined)
    .finally(() => {
      connectionAttempt = null;
    });

  return connectionAttempt;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
}

export function getDatabaseStatus(): DatabaseStatus {
  const readyStateByCode: Record<number, DatabaseStatus> = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return readyStateByCode[mongoose.connection.readyState] ?? "disconnected";
}
