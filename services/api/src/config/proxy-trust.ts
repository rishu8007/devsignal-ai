import type { Express } from "express";

export function configureProxyTrust(application: Express, trustedProxyHops: number): void {
  application.set("trust proxy", trustedProxyHops);
}
