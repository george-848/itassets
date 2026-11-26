import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpToken(secret: string, counterOffset = 0, stepSeconds = 30): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds) + counterOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const clean = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  for (const offset of [-1, 0, 1]) {
    const expected = generateTotpToken(secret, offset);
    if (
      expected.length === clean.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))
    ) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(params: {
  email: string;
  secret: string;
  issuer?: string;
}): string {
  const issuer = encodeURIComponent(params.issuer || 'AssetVault IT');
  const account = encodeURIComponent(params.email);
  return `otpauth://totp/${issuer}:${account}?secret=${params.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}
