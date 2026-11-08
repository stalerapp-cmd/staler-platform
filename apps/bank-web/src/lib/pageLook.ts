import { useLocation } from 'react-router-dom';
import {
  ArrowRightLeft, BookText, CircleHelp, Contact, LifeBuoy, PhoneCall, Plane, Repeat, Trophy, Crown, FileClock, Home, KeyRound, Landmark, LayoutDashboard, QrCode, ScanLine, Settings2, ShieldCheck, Users, Vault, Wallet,
  type LucideIcon,
} from 'lucide-react';

export type NoteTone = 'vault' | 'brass' | 'ruby' | 'sage' | 'sky';

/** Colour and icon of each page's banknote banner, by route. */
const LOOKS: [RegExp, NoteTone, LucideIcon][] = [
  [/^\/app\/transfer/, 'vault', ArrowRightLeft],
  [/^\/app\/transactions/, 'sage', BookText],
  [/^\/app\/requests|^\/app\/pay/, 'brass', QrCode],
  [/^\/app\/scan/, 'vault', ScanLine],
  [/^\/app\/wallet|^\/app\/withdraw/, 'ruby', Wallet],
  [/^\/app\/apps/, 'sky', KeyRound],
  [/^\/app\/settings/, 'sky', Settings2],
  [/^\/app\/beneficiaries/, 'sage', Contact],
  [/^\/app\/scheduled|^\/app\/admin\/scheduled/, 'brass', Repeat],
  [/^\/app\/help/, 'sky', CircleHelp],
  [/^\/app\/admin\/calls/, 'sage', PhoneCall],
  [/^\/app\/admin\/support/, 'sage', LifeBuoy],
  [/^\/app\/admin\/team/, 'brass', Trophy],
  [/^\/app\/admin\/leaves/, 'sky', Plane],
  [/^\/app\/admin\/customers/, 'vault', Users],
  [/^\/app\/admin\/ledger/, 'brass', Landmark],
  [/^\/app\/admin\/exchange/, 'sage', Vault],
  [/^\/app\/admin\/audit/, 'vault', FileClock],
  [/^\/app\/admin\/settings/, 'sky', ShieldCheck],
  [/^\/app\/admin\/admins/, 'brass', Crown],
  [/^\/app\/admin/, 'vault', LayoutDashboard],
];

export function usePageLook(): { tone: NoteTone; icon: LucideIcon } {
  const { pathname } = useLocation();
  const hit = LOOKS.find(([re]) => re.test(pathname));
  return hit ? { tone: hit[1], icon: hit[2] } : { tone: 'vault', icon: Home };
}
