import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../server/createApiApp.ts';

const app = createApiApp();

export default function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const queryIdx = req.url?.indexOf('?') ?? -1;
  const query = queryIdx >= 0 ? req.url!.slice(queryIdx) : '';
  req.url = `/api/health${query}`;

  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    res.once('finish', done);
    res.once('close', done);
    app(req as never, res as never);
  });
}
