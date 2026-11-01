import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';

/**
 * Validates and REPLACES req.body / req.query / req.params with the parsed
 * output. Schemas are strict: unknown keys are rejected, which blocks
 * mass-assignment attacks such as sending {"role":"admin"} at registration.
 */
export function validate(schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request["params"];
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const uuid = z.string().uuid();
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email('Invalid e-mail address');
export const fullName = z
  .string()
  .trim()
  .min(2, 'Name is too short')
  .max(80, 'Name is too long')
  // Letters in any language, digits, spaces and common name punctuation (Exchange2026, Ali & Sons, O'Brien).
  .regex(/^[\p{L}\p{M}\p{N}' .&_()-]+$/u, 'Use letters, numbers, spaces and . - \' & _ only');
/**
 * Codes typed on a phone: an Arabic keyboard sends ٠-٩ (or Persian ۰-۹), authenticator
 * apps show "123 456", and copy-paste brings invisible marks. Turn all of that into plain digits.
 */
export function cleanCode(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  let s = v
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim();
  // "123 456" / "123-456" → "123456"; recovery codes keep their single dash.
  if (/^[\d\s.-]+$/.test(s) && s.replace(/\D/g, '').length === 6) s = s.replace(/\D/g, '');
  else s = s.replace(/\s+/g, '');
  return s;
}
export const otpCode = z.preprocess(cleanCode, z.string().regex(/^\d{6}$/, 'Code must be 6 digits'));
export const totpCode = z.preprocess(cleanCode, z.string().regex(/^(\d{6}|[A-Z0-9]{4}-[A-Z0-9]{4})$/i, 'Invalid authenticator code'));
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, 'Username: 3-32 letters, digits or _');
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const pageQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
