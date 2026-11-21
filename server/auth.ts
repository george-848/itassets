import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { User, UserRole } from '../src/types/itams.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto
        .createHash('sha256')
        .update(`assetvault-it-local-secret-${process.cwd()}`)
        .digest('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: string;
  email: string;
  role: UserRole;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  authUser?: User;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function signSessionToken(user: Pick<User, 'id' | 'email' | 'role'>): string {
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SessionPayload;
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export interface OAuthStatePayload {
  nonce: string;
  redirectUri: string;
  exp: number;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`oauth-state:${encoded}`)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`oauth-state:${encoded}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as OAuthStatePayload;
    if (!payload.nonce || !payload.redirectUri || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const c of cookies) {
      const [rawKey, ...rest] = c.trim().split('=');
      if (rawKey === 'av_session') {
        return decodeURIComponent(rest.join('='));
      }
    }
  }
  return null;
}

export function createAuthMiddleware(
  getUserById: (id: string) => Promise<User | null>
) {
  return async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    const token = extractTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expired or invalid.' });
      return;
    }
    const user = await getUserById(payload.userId);
    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'User account is inactive or unavailable.' });
      return;
    }
    req.authUser = user;
    next();
  };
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Administrator privileges required for this action.' });
    return;
  }
  next();
}
