import type { Request } from 'express';
import { S, type Db, pool } from './db.js';
import { clientIp, userAgent } from './http.js';
import { logger } from './logger.js';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/** Append-only security/audit trail. Never throws — auditing must not break business flows. */
export async function audit(entry: AuditEntry, req?: Request, client: Db = pool): Promise<void> {
  try {
    await client.query(
      `INSERT INTO ${S}.audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        JSON.stringify(entry.details ?? {}),
        req ? clientIp(req) : null,
        req ? userAgent(req) : null,
      ],
    );
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}
