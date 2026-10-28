/**
 * MACHINE-DRAFTED Welsh (`cy`): written by an AI model, not by a native speaker, and not yet reviewed.
 * It needs a native-speaker review before it is relied on at an event; see ../REVIEW.md for the terms that were
 * least certain. Keys missing from here fall back to English.
 */
import type { Catalogue } from '../en';
import { account } from './account.ts';
import { auth } from './auth.ts';
import { common } from './common.ts';
import { competition } from './competition.ts';
import { entries } from './entries.ts';
import { ops } from './ops.ts';
import { shell } from './shell.ts';
import { teams } from './teams.ts';

export const AREAS = { common, shell, auth, account, entries, competition, teams, ops } as const;

export const cy: Catalogue = { ...common, ...shell, ...auth, ...account, ...entries, ...competition, ...teams, ...ops };
