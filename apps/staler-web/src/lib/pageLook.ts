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
  [/^\/app\/stores|^\/stores/, 'sand', Store],
  [/^\/app\/store|^\/store/, 'sand', ShoppingBag],
  [/^\/app\/orders/, 'sand', ClipboardList],
  [/^\/app\/messages/, 'olive', MessageCircle],
  [/^\/app\/contacts/, 'olive', Contact],
  [/^\/app\/help/, 'sky', HelpCircle],
  [/^\/app\/settings/, 'sky', Cog],
  [/^\/app\/merchant\/products/, 'sand', Package],
  [/^\/app\/merchant\/orders/, 'sand', ClipboardList],
  [/^\/app\/merchant\/stores/, 'sand', GitBranch],
  [/^\/app\/merchant\/ads/, 'sand', Megaphone],
  [/^\/app\/merchant/, 'sand', Store],
  [/^\/app\/admin\/users/, 'night', Users],
  [/^\/app\/admin\/stores/, 'sand', Store],
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
