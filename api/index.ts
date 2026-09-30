import { createApp } from '../server/app.js';

/**
 * Vercel Function entrypoint.
 *
 * Vercel routes every request that is not a static asset to this function. The
 * built SPA is served by Vercel's static output (see vercel.json), and every
 * /api/* request is handled by the exact same Express app the dev server uses.
 */
const app = createApp();

export default app;
