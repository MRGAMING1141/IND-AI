import type { Request, Response } from 'express';
import app from '../../../../../server.ts';

// Explicit Vercel entry point for GET /api/agent/chat/jobs/:jobId.
export default function handler(req: Request, res: Response): void {
  const requestUrl = req.url || '/';
  const queryIndex = requestUrl.indexOf('?');
  const query = queryIndex >= 0 ? requestUrl.slice(queryIndex) : '';
  const pathPart = requestUrl.slice(0, queryIndex >= 0 ? queryIndex : undefined);
  const fromUrl = pathPart.split('/').filter(Boolean).at(-1);
  const queryId = req.query.jobId;
  const jobId = typeof queryId === 'string' ? queryId : (fromUrl || '');
  req.url = `/api/agent/chat/jobs/${encodeURIComponent(jobId)}${query}`;
  app(req, res);
}
