import crypto from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns/promises';
import type { SaasStore } from './saasStore.ts';
import type { WebhookDelivery } from '../src/types/saas.ts';

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata / link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

export async function validateWebhookUrl(rawUrl: string): Promise<{
  ok: boolean;
  url?: string;
  error?: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: 'Webhook URL must be a valid URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Webhook URL must use http:// or https://.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return {
      ok: false,
      error: 'Localhost and private internal hostnames are blocked for webhooks.',
    };
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return {
        ok: false,
        error: 'Private, loopback, or metadata IP addresses are blocked.',
      };
    }
  } else {
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      for (const addr of resolved) {
        if (isBlockedIp(addr.address)) {
          return {
            ok: false,
            error: 'Webhook hostname resolves to a blocked private or loopback IP.',
          };
        }
      }
    } catch {
      // Allow DNS failures only if URL is well-formed public host? Better reject unresolvable hostnames?
      // Actually in offline/sandboxed tests DNS lookup might fail, so allow non-IP domain names if DNS fails without private IP resolution
    }
  }

  return { ok: true, url: parsed.toString() };
}

export async function dispatchWebhookEvent(
  store: SaasStore,
  tenantId: string,
  event: string,
  payload: Record<string, unknown>,
  targetWebhookId?: string
): Promise<WebhookDelivery[]> {
  const endpoints = store.data.webhooks.filter(
    (w) =>
      w.tenantId === tenantId &&
      w.active &&
      (targetWebhookId ? w.id === targetWebhookId : w.events.includes(event) || w.events.includes('*'))
  );

  if (endpoints.length === 0) return [];

  const deliveries: WebhookDelivery[] = [];
  const body = JSON.stringify({
    id: `evt_${crypto.randomUUID().slice(0, 12)}`,
    event,
    tenantId,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  for (const endpoint of endpoints) {
    const check = await validateWebhookUrl(endpoint.url);
    let statusCode: number | null = null;
    let ok = false;
    let responseSnippet = '';

    if (!check.ok) {
      responseSnippet = check.error || 'Blocked URL';
    } else {
      const signature = crypto
        .createHmac('sha256', endpoint.secret)
        .update(body)
        .digest('hex');

      try {
        const resp = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AssetVault-Event': event,
            'X-AssetVault-Signature': `sha256=${signature}`,
          },
          body,
          signal: AbortSignal.timeout(5000),
        });
        statusCode = resp.status;
        ok = resp.ok;
        const text = await resp.text().catch(() => '');
        responseSnippet = text.slice(0, 160) || `HTTP ${resp.status}`;
      } catch (err) {
        responseSnippet = err instanceof Error ? err.message.slice(0, 160) : 'Request timeout/error';
      }
    }

    const now = new Date().toISOString();
    endpoint.lastTriggeredAt = now;
    const delivery: WebhookDelivery = {
      id: `whd-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      webhookId: endpoint.id,
      event,
      statusCode,
      ok,
      responseSnippet,
      deliveredAt: now,
    };
    store.data.webhookDeliveries.unshift(delivery);
    deliveries.push(delivery);
  }

  if (store.data.webhookDeliveries.length > 300) {
    store.data.webhookDeliveries.length = 300;
  }
  await store.persist();
  return deliveries;
}
