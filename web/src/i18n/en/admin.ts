import type { Message } from '../messages';
import { adminFormat } from './admin-parts/format.ts';
import { adminEmail } from './admin-parts/email.ts';
import { adminAccounts } from './admin-parts/accounts.ts';
import { adminCreator } from './admin-parts/creator.ts';

/** Parts live in admin-parts/ so several people can work on them at once; the keys all start `admin.`. */
export const admin = {
  ...adminFormat,
  ...adminEmail,
  ...adminAccounts,
  ...adminCreator,
} satisfies Record<string, Message>;
