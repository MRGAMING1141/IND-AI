import type { Request, Response } from 'express';
import app from '../server.ts';

/**
 * Vercel catch-all functions can expose the matched path with or without
 * the /api prefix. The Express routes are registered under /api/*, so
 * normalize the URL before handing the request to the app.
 */
export default function handler(req: Request, res: Response): void {
  const requestUrl = req.url || '/';
  if (!requestUrl.startsWith('/api/')) {
    req.url = `/api${requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`}`;
  }
  app(req, res);
}
