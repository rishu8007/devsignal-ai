import { z } from "zod";

export const linkedinConnectSchema = z.object({
  returnPath: z.string().optional(),
}).strict();
