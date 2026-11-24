import type { Request, Response } from 'express';
import app from '../../server.ts';

// Explicit Vercel entry point for POST /api/agent/chat.
export default function handler(req: Request, res: Response): void {
  const requestUrl = req.url || '/';
  const queryIndex = requestUrl.indexOf('?');
  const query = queryIndex >= 0 ? requestUrl.slice(queryIndex) : '';
  req.url = `/api/agent/chat${query}`;
  app(req, res);
}
