import type { Request, Response } from 'express';
import app from '../../server.ts';

/**
 * Route nested drive API requests through the shared Express application.
 * Vercel may strip the filesystem route prefix from req.url, so restore it.
 */
export default function handler(req: Request, res: Response): void {
  const requestUrl = req.url || '/';
  if (!requestUrl.startsWith('/api/')) {
    const suffix = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`;
    req.url = `/api/drive${suffix}`;
  }
  app(req, res);
}
