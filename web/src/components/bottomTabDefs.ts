import {
  ClipboardList,
  Clock,
  Info,
  MapPin,
  MessageSquare,
  ShoppingBag,
  Sliders,
  Star,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { BottomTabId } from '../lib/userPrefs';
import type { MessageKey } from '../i18n/en';

export interface TabDef {
  id: BottomTabId;
  label: MessageKey;
  icon: LucideIcon;
  to: (base: string) => string;
  isActive: (section: string | undefined) => boolean;
  organiserOnly?: boolean;
}

/** What each bottom tab is: its words, icon and where it goes. The bar and the Following prompt's preview both draw from it. */
export const TAB_DEFS: Record<BottomTabId, TabDef> = {
  timetable: {
    id: 'timetable',
    label: 'shell.tab.timetable',
    icon: Clock,
    to: (base) => base,
    isActive: (section) =>
      section === '' || section === 'session' || section === 'scoring',
  },
  toplists: {
    id: 'toplists',
    label: 'shell.tab.toplists',
    icon: Trophy,
    to: (base) => `${base}/toplists`,
    isActive: (section) => section === 'toplists',
  },
  following: {
    id: 'following',
    label: 'shell.tab.following',
    icon: Star,
    to: (base) => `${base}/following`,
    isActive: (section) => section === 'following',
  },
  chat: {
    id: 'chat',
    label: 'shell.tab.chat',
    icon: MessageSquare,
    to: (base) => `${base}/chat`,
    isActive: (section) => section === 'chat',
  },
  teams: {
    id: 'teams',
    label: 'shell.tab.teams',
    icon: Users,
    to: (base) => `${base}/teams`,
    isActive: (section) => section === 'teams',
  },
  arena: {
    id: 'arena',
    label: 'shell.tab.arena',
    icon: MapPin,
    to: (base) => `${base}/arena`,
    isActive: (section) => section === 'arena',
  },
  declarations: {
    id: 'declarations',
    label: 'shell.tab.declarations',
    icon: ClipboardList,
    to: (base) => `${base}/declarations`,
    isActive: (section) => section === 'declarations',
  },
  shop: {
    id: 'shop',
    label: 'shell.tab.shop',
    icon: ShoppingBag,
    to: (base) => `${base}/shop`,
    isActive: (section) => section === 'shop',
  },
  details: {
    id: 'details',
    label: 'shell.tab.details',
    icon: Info,
    to: (base) => `${base}/details`,
    isActive: (section) => section === 'details' || section === 'sponsors',
  },
  operations: {
    id: 'operations',
    label: 'shell.tab.operations',
    icon: Sliders,
    organiserOnly: true,
    to: (base) => `${base}/operations`,
    isActive: (section) => section === 'operations',
  },
};
