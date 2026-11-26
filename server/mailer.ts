import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import type { SaasStore } from './saasStore.ts';
import type { EmailOutboxEntry } from '../src/types/saas.ts';

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim());
}

export async function sendTransactionalEmail(
  store: SaasStore,
  params: {
    tenantId: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }
): Promise<EmailOutboxEntry> {
  const now = new Date().toISOString();
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const from =
    process.env.SMTP_FROM?.trim() ||
    store.data.platformSettings.supportEmail ||
    'AssetVault IT <no-reply@assetvault.local>';

  let status: EmailOutboxEntry['status'] = 'logged_local';
  let error: string | undefined;

  if (host && user) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass: pass || '' },
      });
      await transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : 'SMTP delivery failed.';
      console.error('[AssetVault Mailer] SMTP send error:', error);
    }
  } else {
    console.info(
      `[AssetVault Mailer] (Local Outbox) To: ${params.to} | Subject: ${params.subject}`
    );
  }

  const entry: EmailOutboxEntry = {
    id: `mail-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: params.tenantId,
    to: params.to,
    subject: params.subject,
    bodyPreview: params.text.slice(0, 280),
    status,
    error,
    sentAt: now,
  };

  store.data.emailOutbox.unshift(entry);
  if (store.data.emailOutbox.length > 150) {
    store.data.emailOutbox.length = 150;
  }
  await store.persist();
  return entry;
}
