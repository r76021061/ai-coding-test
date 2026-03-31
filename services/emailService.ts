import nodemailer from "nodemailer";
import { marked } from "marked";

const EMAIL_TEMPLATE_STYLES = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.8; color: #334155; max-width: 850px; margin: 0 auto;
  padding: 20px; background-color: #ffffff; font-size: 19px;
`;

function buildEmailHtml(parsedHtml: string): string {
  return `
    <div style="${EMAIL_TEMPLATE_STYLES}">
      <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
        <h2 style="color: #0f172a; margin: 0; font-size: 28px;">財經 AI 秘書</h2>
        <p style="color: #64748b; font-size: 17px; margin-top: 8px;">為您整理的最新財經重點</p>
      </div>
      <div style="background-color: #f8fafc; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0;">
        ${parsedHtml}
      </div>
      <div style="margin-top: 30px; text-align: center; font-size: 14px; color: #94a3b8; padding-top: 20px; border-top: 1px solid #e2e8f0;">
        <p>此信件由 AI 自動摘要生成，僅供參考，不構成投資建議。</p>
      </div>
    </div>
  `;
}

function createTransporter() {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    throw new Error("Email service is not configured. Missing SMTP env vars.");
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Sends a markdown-formatted summary email to one or more recipients.
 * Returns false if SMTP is not configured (non-throwing, logs the error).
 */
export async function sendSummaryEmail(
  to: string[],
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    const transporter = createTransporter();
    const parsedHtml = await marked.parse(body);
    const html = buildEmailHtml(parsedHtml);

    await transporter.sendMail({
      from: `"財經 AI 秘書" <${process.env.SMTP_USER}>`,
      to: to.join(", "),
      subject,
      text: body,
      html,
    });

    return true;
  } catch (error) {
    console.error("Email send error:", error);
    return false;
  }
}

/** Returns the list of configured cron recipient emails from env. */
export function getCronEmails(): string[] {
  const emailsStr = process.env.CRON_EMAILS || "";
  if (!emailsStr) return [];
  return emailsStr.split(",").map((e) => e.trim()).filter(Boolean);
}

/** Returns true when SMTP environment variables are all present. */
export function isEmailConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}
