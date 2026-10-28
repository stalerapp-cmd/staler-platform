import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { cooldownDuration: 60_000, cacheMaxAge: 6 * 3600_000 });

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

/** Verifies a Google Identity Services ID token (signature, audience, issuer, expiry, verified e-mail). */
export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  if (!env.GOOGLE_CLIENT_ID) throw unauthorized('Google sign-in is not enabled', 'GOOGLE_DISABLED');
  try {
    const { payload } = await jwtVerify(credential, JWKS, {
      audience: env.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      clockTolerance: 30,
    });
    const email = String(payload.email ?? '').toLowerCase();
    if (!email || payload.email_verified !== true) throw new Error('unverified');
    return { sub: String(payload.sub), email, name: String(payload.name ?? email.split('@')[0]).slice(0, 100) };
  } catch {
    throw unauthorized('Google sign-in failed, try again', 'GOOGLE_INVALID');
  }
}
