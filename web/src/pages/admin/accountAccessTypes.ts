import { tr } from '../../i18n/translate';

// Wire types for locking, blocking and inviting accounts (api/Dtos/AccountAccessDtos.cs). Enums travel as numbers.

/** What an invited person becomes: 0 an organiser (approved Trainer), 1 a site admin (Admin). */
export type InviteAccess = 0 | 1;

/** Matches `EmailDeliveryStatus`: 1 sent, 2 failed, 3 sending is switched off. 0 means nothing was due. */
export type InviteEmailStatus = 0 | 1 | 2 | 3;

export interface AccountInvite {
  id: number;
  email: string;
  access: InviteAccess;
  createdAt: string;
  expiresAt: string;
  lastSentAt: string | null;
  emailStatus: InviteEmailStatus;
  sendCount: number;
  /** Still pending, but its link no longer works. Resend to issue a new one. */
  isExpired: boolean;
  invitedByName: string | null;
}

/** `POST /api/auth/invites/lookup`: what the accept page may show before a name and password are chosen. */
export interface InvitePreview {
  email: string;
  access: InviteAccess;
  expiresAt: string;
}

/** A blocked account. `reason` is for admins only and is never shown to the blocked person. */
export interface BlockedAccount {
  id: string;
  fullName: string;
  email: string | null;
  roles: string[];
  blockedAt: string;
  blockedByName: string | null;
  reason: string | null;
}

/** `GET /api/admin/staff-accounts` (master admin only): Admin and organiser accounts with their lock state. */
export interface StaffAccount {
  id: string;
  fullName: string;
  email: string | null;
  roles: string[];
  lockedAt: string | null;
  createdAt: string;
}

/** `GET /api/admin/users?q=`: an account found by name, email or club. */
export interface AdminUser {
  id: string;
  fullName: string;
  email: string | null;
  clubId: number | null;
  clubName: string | null;
  roles: string[];
  isLockedOut: boolean;
  createdAt: string;
  isLocked: boolean;
  isBlocked: boolean;
}

/** What an account is called on the Users page. */
export function accountKind(roles: readonly string[]): string {
  if (roles.includes('MasterAdmin')) return tr('admin.accounts.kind.master');
  if (roles.includes('Admin')) return tr('admin.accounts.kind.admin');
  if (roles.includes('Trainer')) return tr('admin.accounts.kind.organiser');
  if (roles.includes('TrainerRequest')) return tr('admin.accounts.kind.wantsOrganise');
  if (roles.includes('Manager')) return tr('admin.accounts.kind.manager');
  if (roles.includes('ManagerRequest')) return tr('admin.accounts.kind.wantsManage');
  if (roles.includes('Rider')) return tr('admin.accounts.kind.rider');
  return tr('admin.accounts.kind.supporter');
}
