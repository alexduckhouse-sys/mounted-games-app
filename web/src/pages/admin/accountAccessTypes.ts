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
