import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { one, S } from './db.js';
import { logger } from './logger.js';

/**
 * File storage with two drivers:
 *  - Supabase Storage (same buckets as before: product-images, digital-products, avatars)
 *  - PostgreSQL (bytea) when Supabase isn't configured — works on any host.
 * Public URLs point at /files/:id for the DB driver.
 */
export type Bucket = 'product-images' | 'digital-products' | 'avatars';
const PUBLIC_BUCKETS: Bucket[] = ['product-images', 'avatars'];

let supa: SupabaseClient | null = null;
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
  supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export const storageDriver = supa ? 'supabase' : 'database';

export interface Stored {
  ref: string; // what we store in the DB (URL for public files, opaque ref for private ones)
  url: string | null;
}

export async function putFile(bucket: Bucket, ownerId: string, ext: string, mime: string, data: Buffer, originalName: string): Promise<Stored> {
  const name = `${ownerId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  if (supa) {
    const { error } = await supa.storage.from(bucket).upload(name, data, { contentType: mime, upsert: false });
    if (error) {
      logger.error({ err: error.message, bucket }, 'storage upload failed');
      throw new Error('upload failed');
    }
    if (PUBLIC_BUCKETS.includes(bucket)) {
      const url = supa.storage.from(bucket).getPublicUrl(name).data.publicUrl;
      return { ref: url, url };
    }
    return { ref: name, url: null };
  }
  const row = await one<{ id: string }>(
    `INSERT INTO ${S}.stored_files (owner_id, bucket, filename, mime, size, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [ownerId, bucket, originalName.slice(0, 200), mime, data.length, data],
  );
  const url = PUBLIC_BUCKETS.includes(bucket) ? `/files/${row!.id}` : null;
  return { ref: url ?? `db:${row!.id}`, url };
}

/** Short-lived download link for a private file (digital products). */
export async function privateDownload(ref: string): Promise<{ redirect?: string; file?: { data: Buffer; mime: string; filename: string } } | null> {
  if (ref.startsWith('db:')) {
    const f = await one<any>(`SELECT data, mime, filename FROM ${S}.stored_files WHERE id = $1 AND bucket = 'digital-products'`, [ref.slice(3)]);
    return f ? { file: { data: f.data, mime: f.mime, filename: f.filename } } : null;
  }
  if (!supa) return null;
  const { data, error } = await supa.storage.from('digital-products').createSignedUrl(ref, 300);
  if (error || !data) return null;
  return { redirect: data.signedUrl };
}

export async function publicFile(id: string) {
  return one<{ data: Buffer; mime: string }>(
    `SELECT data, mime FROM ${S}.stored_files WHERE id = $1 AND bucket = ANY($2)`,
    [id, PUBLIC_BUCKETS],
  );
}
