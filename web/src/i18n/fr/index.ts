/**
 * MACHINE-DRAFTED French (`fr`): written by an AI model, not by a native speaker, and not yet reviewed.
 * It needs a native-speaker review before it is relied on at an event; see ../REVIEW.md for the terms that were
 * least certain. Keys missing from here fall back to English.
 */
import type { Catalogue } from '../en';
import { account } from './account';
import { auth } from './auth';
import { common } from './common';
import { competition } from './competition';
import { entries } from './entries';
import { shell } from './shell';
import { teams } from './teams';

export const AREAS = { common, shell, auth, account, entries, competition, teams } as const;

export const fr: Catalogue = { ...common, ...shell, ...auth, ...account, ...entries, ...competition, ...teams };
