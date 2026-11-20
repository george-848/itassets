import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApiApp, getSharedDatabase } from '../server/app.ts';

let cachedApp: Express | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    // Restore original /api/<route> path when rewritten by vercel.json
    if (req.url) {
      const parsed = new URL(req.url, 'http://localhost');
      const vpath = parsed.searchParams.get('__vpath');
      if (vpath !== null) {
        parsed.searchParams.delete('__vpath');
        const qs = parsed.searchParams.toString();
        req.url = `/api/${vpath}${qs ? `?${qs}` : ''}`;
      }
    }

    if (!cachedApp) {
      const db = await getSharedDatabase();
      cachedApp = createApiApp(db);
    }

    return cachedApp(req as Parameters<Express>[0], res as Parameters<Express>[1]);
  } catch (err) {
    console.error('Vercel API handler error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error:
          err instanceof Error
            ? err.message
            : 'Internal server error initializing database.',
      })
    );
  }
}
