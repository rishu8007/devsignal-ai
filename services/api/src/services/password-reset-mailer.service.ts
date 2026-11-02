import nodemailer from "nodemailer";
import { env } from "../config/env.js";

export interface PasswordResetMailer {
  sendPasswordReset(input: { recipient: string; resetUrl: string; expiresAt: Date }): Promise<void>;
}

function resetEmailText(resetUrl: string): string {
  return [
    "A password reset was requested for your DevSignal AI account.",
    "",
    `Reset your password: ${resetUrl}`,
    "",
    "This link expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.",
  ].join("\n");
}

class SmtpPasswordResetMailer implements PasswordResetMailer {
  public async sendPasswordReset(input: { recipient: string; resetUrl: string; expiresAt: Date }): Promise<void> {
    if (!env.SMTP_HOST || !env.SMTP_FROM) {
      throw new Error("SMTP is not configured");
    }
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USERNAME && env.SMTP_PASSWORD
        ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
        : undefined,
    });
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: input.recipient,
      subject: "Reset your DevSignal AI password",
      text: resetEmailText(input.resetUrl),
      html: `<p>A password reset was requested for your DevSignal AI account.</p><p><a href="${input.resetUrl}">Reset your password</a></p><p>This link expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.</p>`,
    });
  }
}

export const passwordResetMailer: PasswordResetMailer = new SmtpPasswordResetMailer();
