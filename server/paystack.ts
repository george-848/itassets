import crypto from 'node:crypto';
import type { BillingCycle, PlanCode } from '../src/types/saas.ts';

function cleanEnv(val?: string): string {
  return (val || '').trim().replace(/^["']|["']$/g, '');
}

export function isPaystackLiveConfigured(): boolean {
  return cleanEnv(process.env.PAYSTACK_SECRET_KEY).startsWith('sk_');
}

export function getPaystackPublicKeyHint(): string {
  const pub = cleanEnv(process.env.PAYSTACK_PUBLIC_KEY);
  if (!pub) return 'Not configured (Test simulation mode)';
  return `${pub.slice(0, 12)}...${pub.slice(-4)}`;
}

export async function initializePaystackPayment(params: {
  email: string;
  amountGhs: number;
  reference: string;
  callbackUrl: string;
  tenantId: string;
  planCode: PlanCode;
  billingCycle: BillingCycle;
}): Promise<{
  mode: 'paystack' | 'test_simulation';
  authorizationUrl: string | null;
  reference: string;
}> {
  const secretKey = cleanEnv(process.env.PAYSTACK_SECRET_KEY);
  if (!secretKey) {
    // Explicit test simulation mode when PAYSTACK_SECRET_KEY is unset
    return {
      mode: 'test_simulation',
      authorizationUrl: null,
      reference: params.reference,
    };
  }

  const amountPesewas = Math.round(params.amountGhs * 100);
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      amount: amountPesewas,
      currency: 'GHS',
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: {
        tenantId: params.tenantId,
        planCode: params.planCode,
        billingCycle: params.billingCycle,
      },
    }),
  });

  const payload = (await res.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string };
  };

  if (!res.ok || !payload.status || !payload.data?.authorization_url) {
    throw new Error(
      payload.message || 'Paystack failed to initialize transaction.'
    );
  }

  return {
    mode: 'paystack',
    authorizationUrl: payload.data.authorization_url,
    reference: payload.data.reference || params.reference,
  };
}

export async function verifyPaystackTransaction(reference: string): Promise<{
  verified: boolean;
  mode: 'paystack' | 'test_simulation';
  status: 'success' | 'failed' | 'pending';
  amountGhs: number | null;
  channel: string;
}> {
  const secretKey = cleanEnv(process.env.PAYSTACK_SECRET_KEY);
  if (!secretKey) {
    return {
      verified: true,
      mode: 'test_simulation',
      status: 'success',
      amountGhs: null,
      channel: 'test_simulation_card',
    };
  }

  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    }
  );

  const payload = (await res.json()) as {
    status?: boolean;
    data?: {
      status?: string;
      amount?: number;
      currency?: string;
      channel?: string;
    };
  };

  if (!res.ok || !payload.status || !payload.data) {
    return {
      verified: false,
      mode: 'paystack',
      status: 'failed',
      amountGhs: null,
      channel: 'unknown',
    };
  }

  const txStatus = payload.data.status === 'success' ? 'success' : 'failed';
  return {
    verified: txStatus === 'success',
    mode: 'paystack',
    status: txStatus,
    amountGhs:
      typeof payload.data.amount === 'number'
        ? payload.data.amount / 100
        : null,
    channel: payload.data.channel || 'paystack',
  };
}

export function verifyPaystackWebhookSignature(
  rawBody: string,
  signatureHeader?: string
): boolean {
  const secretKey = cleanEnv(process.env.PAYSTACK_SECRET_KEY);
  if (!secretKey || !signatureHeader) return false;
  const expected = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');
  const sigBuf = Buffer.from(signatureHeader.trim(), 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
