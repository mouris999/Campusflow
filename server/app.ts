import express, { type Express } from 'express';
import { apiRouter } from './api.js';
import { IS_EPHEMERAL_STORAGE } from './paths.js';

/**
 * Builds the CampusFlow Express application.
 *
 * Both the local dev server (server.ts) and the Vercel function entrypoint
 * (api/index.ts) mount this, so routing and middleware can never drift apart
 * between environments.
 */
export function createApp(): Express {
  const app = express();

  // Correct client IPs/rate limiting behind a proxy.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));

  // Baseline security headers for every response.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      // Never hide that the deployment is running on ephemeral storage.
      storage: IS_EPHEMERAL_STORAGE ? 'ephemeral' : 'persistent'
    });
  });

  app.use('/api', apiRouter);

  // Anything under /api that reached here is genuinely not implemented.
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Unknown API endpoint.' });
  });

  // Keep a thrown error from leaving the function in an undefined state.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[campusflow] unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: 'Unexpected server error.' });
  });

  return app;
}
