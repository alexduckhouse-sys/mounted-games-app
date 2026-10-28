import type { AreaCatalogue } from '../messages';
import type { admin as en } from '../en/admin.ts';
import { adminFormat } from './admin-parts/format.ts';
import { adminEmail } from './admin-parts/email.ts';
import { adminAccounts } from './admin-parts/accounts.ts';
import { adminCreator } from './admin-parts/creator.ts';

export const admin: AreaCatalogue<typeof en> = {
  ...adminFormat,
  ...adminEmail,
  ...adminAccounts,
  ...adminCreator,
};
