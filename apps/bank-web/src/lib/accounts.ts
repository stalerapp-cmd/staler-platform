import { useData } from './hooks';
import type { Account } from '../components/Bank';

/** The customer's accounts; most customers have one, the first is the primary. */
export function useAccounts() {
  const r = useData<{ accounts: Account[] }>('/api/accounts');
  return { ...r, accounts: r.data?.accounts ?? [], primary: r.data?.accounts?.[0] ?? null };
}

export function useConfig() {
  return useData<{ bankName: string; currency: string; maxTransfer: string; dailyLimit: string; publicUrl: string }>('/api/config');
}
