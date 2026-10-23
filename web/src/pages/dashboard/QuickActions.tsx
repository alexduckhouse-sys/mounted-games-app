import { Link } from 'react-router-dom';
import { BookOpen, ClipboardCheck, Megaphone, Plus, Radio, Trophy, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import type { CompetitionPickerItem } from '../../types';

interface Action { key: string; to: string; label: string; sub?: string; icon: LucideIcon; primary?: boolean }

/**
 * The things an organiser does most, as big buttons. Create competition is for admins and trainers; the rest point at
 * the event running today (or the next one this week) and only show for someone who can organise it.
 */
export function QuickActions({ focus, today }: { focus: CompetitionPickerItem | null; today: boolean }) {
  const { hasRole, canOrganise } = useAuth();
  const isAdmin = hasRole('Admin');
  const organises = focus != null && canOrganise({ id: focus.id });
  const actions: Action[] = [];
  if (isAdmin || hasRole('Trainer')) actions.push({ key: 'create', to: '/admin/competitions/new', label: 'Create competition', icon: Plus, primary: true });
  if (focus && organises) {
    if (today) actions.push({ key: 'score', to: `/competitions/${focus.id}/scoring`, label: 'Score now', sub: focus.name, icon: Trophy });
    actions.push({ key: 'announce', to: `/competitions/${focus.id}/chat`, label: 'Post an announcement', sub: focus.name, icon: Megaphone });
    actions.push({ key: 'live', to: `/competitions/${focus.id}/broadcast`, label: 'Go live', sub: focus.name, icon: Radio });
    if (today) actions.push({ key: 'day', to: `/admin/competitions/${focus.id}/format`, label: 'On the day', sub: focus.name, icon: ClipboardCheck });
  }
  if (isAdmin) actions.push({ key: 'rules', to: '/admin/rules', label: 'Rules library', icon: BookOpen });
  if (actions.length === 0) return null;
  return (
    <section aria-label="Quick actions" className="flex flex-col gap-2">
      <div className="mg-section-head"><h2>Quick actions</h2></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {actions.map(({ key, to, label, sub, icon: Icon, primary }) => (
          <Link key={key} to={to} className={`mg-row mg-card !min-h-14 ${primary ? 'mg-btn-primary !text-white' : ''}`}>
            <Icon aria-hidden="true" className={`h-6 w-6 shrink-0 ${primary ? '' : 'text-[rgb(var(--mg-heading))]'}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold leading-tight">{label}</span>
              {sub && <span className="block truncate text-sm font-normal opacity-80">{sub}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
