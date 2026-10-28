import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Forwards async errors to the error middleware (Express 4 does not do this itself). */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
export const userAgent = (req: Request) => String(req.headers['user-agent'] ?? '').slice(0, 300);
