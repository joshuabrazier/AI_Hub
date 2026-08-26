import z from "zod";

// -------------------------------------------------------------------
// Web Push subscribe/unsubscribe requests (browser -> server).
// -------------------------------------------------------------------
export const enablePushSchema = z.object({
  // A stable per-device id (kept in the browser's localStorage).
  installationId: z.string().min(1).max(200),
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

export type EnablePushRequestDTO = z.infer<typeof enablePushSchema>;

export const disablePushSchema = z.object({
  installationId: z.string().min(1).max(200),
});

export type DisablePushRequestDTO = z.infer<typeof disablePushSchema>;
