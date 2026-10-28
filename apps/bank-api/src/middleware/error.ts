import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Single place where errors become HTTP responses. Internals are never leaked. */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as any).id;
  if (res.headersSent) return;

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, requestId }, err.message);
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      requestId,
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues[0]?.message ?? 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      requestId,
    });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large' }, requestId });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Malformed JSON body' }, requestId });
  }
  // PostgreSQL: invalid text representation (e.g. a non-UUID id) -> 400, unique violation -> 409.
  if (err?.code === '22P02' || err?.code === '22003') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid identifier or value' }, requestId });
  }
  if (err?.code === '23505') {
    return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Resource already exists' }, requestId });
  }
  if (err?.code === '23514') {
    return res.status(409).json({ success: false, error: { code: 'CONSTRAINT', message: 'Operation violates a balance rule' }, requestId });
  }
  logger.error({ err, requestId, path: req.path }, 'unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
    requestId,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' }, requestId: (req as any).id });
}
