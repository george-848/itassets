import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const outerApp = express();
const PORT = Number(process.env.PORT) || 3000;

let apiApp: express.Express | null = null;
let frontendHandler: express.RequestHandler | null = null;
let apiStartupError: unknown = null;
let frontendStartupError: unknown = null;

async function initApi(): Promise<express.Express> {
  const [{ createApiApp, getSharedDatabase }, { getSharedSaasStore }] =
    await Promise.all([
      import('./server/app.ts'),
      import('./server/saasStore.ts'),
    ]);

  const [db, saasStore] = await Promise.all([
    getSharedDatabase(),
    getSharedSaasStore(),
  ]);

  const app = createApiApp(db, saasStore);
  apiApp = app;
  return app;
}

async function initFrontend(): Promise<express.RequestHandler> {
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' &&
    fs.existsSync(path.join(distDir, 'index.html'));

  if (isProd) {
    const prodRouter = express.Router();
    prodRouter.use(express.static(distDir));
    prodRouter.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    frontendHandler = prodRouter;
    return prodRouter;
  }

  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
    },
    appType: 'spa',
  });
  frontendHandler = vite.middlewares;
  return vite.middlewares;
}

const apiPromise = initApi().catch((err) => {
  apiStartupError = err;
  console.error('Fatal API startup error:', err);
  process.exit(1);
});

const frontendPromise = initFrontend().catch((err) => {
  frontendStartupError = err;
  console.error('Fatal frontend startup error:', err);
  process.exit(1);
});

// Fast non-blocking health probe while DB connects
outerApp.get('/api/health', (req, res, next) => {
  if (apiApp) {
    apiApp(req, res, next);
    return;
  }
  res.json({ ok: true, initializing: true });
});

// Route /api/* to API app (without stripping /api prefix) and all other routes to Vite/static frontend
outerApp.use(async (req, res, next) => {
  try {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      const app = apiApp ?? (await apiPromise);
      if (apiStartupError || !app) {
        res.status(500).json({ error: 'API failed to initialize.' });
        return;
      }
      app(req, res, next);
      return;
    }

    const handler = frontendHandler ?? (await frontendPromise);
    if (frontendStartupError || !handler) {
      res.status(500).send('Frontend failed to initialize.');
      return;
    }
    handler(req, res, next);
  } catch (err) {
    next(err);
  }
});

outerApp.listen(PORT, '0.0.0.0', () => {
  console.log(`[AssetVault IT] Server listening on http://0.0.0.0:${PORT}`);
});
