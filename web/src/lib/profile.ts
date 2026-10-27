import { tr } from '../i18n/translate';
import type { Role } from '../types';

/** Up to two capital letters for an avatar: first and last word of the name, or the start of the email. */
export function initialsOf(fullName: string | null | undefined, email?: string | null): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const local = (email ?? '').split('@')[0].replace(/[^a-z0-9]/gi, '');
  return (local.slice(0, 2) || '?').toUpperCase();
}

/** The badge text for the most senior role a person holds. */
export function roleLabel(roles: readonly Role[]): string {
  if (roles.includes('Admin')) return tr('account.role.admin');
  if (roles.includes('Manager')) return tr('account.role.manager');
  if (roles.includes('Trainer')) return tr('account.role.trainer');
  if (roles.includes('TrainerRequest')) return tr('account.role.trainerRequest');
  if (roles.includes('ManagerRequest')) return tr('account.role.managerRequest');
  return tr('account.role.member');
}
