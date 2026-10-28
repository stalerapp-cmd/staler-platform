import type { NextFunction, Request, Response } from 'express';
import { forbidden } from './errors.js';

/** Everything an administrator can be allowed to do. The super admin can do all of it, plus manage admins. */
export const PERMISSIONS = [
  'customers.view',
  'customers.edit',
  'customers.password',
  'customers.status',
  'customers.delete',
  'customers.security',
  'accounts.freeze',
  'teller',
  'ledger.view',
  'notify',
  'exchange.view',
  'audit.view',
  'settings.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number] | 'admins.manage';

export const isSuper = (req: Request) => req.auth?.adminLevel === 'super_admin';
export const can = (req: Request, p: Permission) =>
  req.auth?.role === 'admin' && (isSuper(req) || (p !== 'admins.manage' && (req.auth.permissions ?? []).includes(p)));

export const requirePerm =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) =>
    perms.every((p) => can(req, p)) ? next() : next(forbidden('You do not have permission for this action', 'NO_PERMISSION'));

/** Admins may only act on regular accounts; only the super admin may act on admins; nobody acts on the super admin. */
export function assertCanManage(req: Request, target: { id: string; role: string; admin_level?: string | null }) {
  if (String(target.id) === String(req.auth!.userId)) throw forbidden('Use your own settings page for your account', 'SELF');
  if (target.admin_level === 'super_admin') throw forbidden('The super admin account cannot be changed here', 'SUPER_ADMIN');
  if (target.role === 'admin' && !isSuper(req)) throw forbidden('Only the super admin can manage administrators', 'ADMIN_TARGET');
}
