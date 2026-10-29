import { useLocation } from 'react-router-dom';
import {
  Activity, Banknote, Contact, Cog, Crown, FileClock, GitBranch, HandCoins, HelpCircle, Home, Landmark, LayoutDashboard, MapPin, Megaphone,
  MessageCircle, Package, QrCode, Scale, ScanLine, Send, ShieldCheck, ShoppingBag, Store, Ticket, UserPlus, Users, ClipboardList, type LucideIcon,
} from 'lucide-react';
import type { ClothTone } from '../components/ui';

/** Colour and icon of each page's banner, by route — money is night, shopping red, people olive, cash gold. */
const LOOKS: [RegExp, ClothTone, LucideIcon][] = [
  [/^\/app\/send/, 'night', Send],
  [/^\/app\/receive/, 'night', QrCode],
  [/^\/app\/scan/, 'night', ScanLine],
  [/^\/app\/bank/, 'sky', Landmark],
  [/^\/app\/activity/, 'night', Activity],
  [/^\/app\/claim/, 'gold', Ticket],
  [/^\/app\/cashout/, 'gold', Banknote],
  [/^\/app\/vouchers/, 'gold', Ticket],
  [/^\/app\/agents/, 'gold', MapPin],
  [/^\/app\/agent/, 'gold', HandCoins],
  [/^\/app\/store|^\/store/, 'stitch', ShoppingBag],
  [/^\/app\/stores|^\/stores/, 'stitch', Store],
  [/^\/app\/orders/, 'stitch', ClipboardList],
  [/^\/app\/messages/, 'olive', MessageCircle],
  [/^\/app\/contacts/, 'olive', Contact],
  [/^\/app\/help/, 'sky', HelpCircle],
  [/^\/app\/settings/, 'sky', Cog],
  [/^\/app\/merchant\/products/, 'stitch', Package],
  [/^\/app\/merchant\/orders/, 'stitch', ClipboardList],
  [/^\/app\/merchant\/stores/, 'stitch', GitBranch],
  [/^\/app\/merchant\/ads/, 'stitch', Megaphone],
  [/^\/app\/merchant/, 'stitch', Store],
  [/^\/app\/admin\/users/, 'night', Users],
  [/^\/app\/admin\/stores/, 'stitch', Store],
  [/^\/app\/admin\/disputes/, 'stitch', Scale],
  [/^\/app\/admin\/pending/, 'olive', UserPlus],
  [/^\/app\/admin\/bank/, 'sky', Landmark],
  [/^\/app\/admin\/audit/, 'night', FileClock],
  [/^\/app\/admin\/settings/, 'sky', ShieldCheck],
  [/^\/app\/admin\/admins/, 'gold', Crown],
  [/^\/app\/admin/, 'night', LayoutDashboard],
];

export function usePageLook(): { tone: ClothTone; icon: LucideIcon } {
  const { pathname } = useLocation();
  const hit = LOOKS.find(([re]) => re.test(pathname));
  return hit ? { tone: hit[1], icon: hit[2] } : { tone: 'night', icon: Home };
}
