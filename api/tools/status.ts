import type { Request, Response } from 'express';
import app from '../../server.ts';

/**
 * Explicit endpoint for the integrations status check.
 * Normalize the URL because Vercel may strip the /api prefix when invoking
 * a file-based function.
 */
export default function handler(req: Request, res: Response): void {
  const requestUrl = req.url || '/';
  const queryIndex = requestUrl.indexOf('?');
  const query = queryIndex >= 0 ? requestUrl.slice(queryIndex) : '';
  req.url = `/api/tools/status${query}`;
  app(req, res);
}
