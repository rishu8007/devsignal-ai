import type { ListSignalsQuery } from "../validation/signal.validation.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
      };
    }

    interface Locals {
      signalQuery: ListSignalsQuery;
      signalId: string;
    }
  }
}

export {};
