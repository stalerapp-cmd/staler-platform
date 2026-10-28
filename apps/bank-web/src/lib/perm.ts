import { useAuth } from './auth';

/** Mirrors the server's permission check (the server stays the authority). */
export function usePerm() {
  const { user } = useAuth();
  const u = user as (typeof user & { admin_level?: string | null; admin_permissions?: string[] | null }) | null;
  const isSuper = u?.role === 'admin' && u.admin_level === 'super_admin';
  const can = (p: string) => u?.role === 'admin' && (isSuper || (p !== 'admins.manage' && (u.admin_permissions ?? []).includes(p)));
  return { can, isSuper };
}
