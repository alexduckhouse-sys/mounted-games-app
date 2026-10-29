import { reliability } from './reliability.ts';
import { timing } from './timing.ts';
import { completion } from './completion.ts';
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
import { screen } from './screen.ts';
import { ops } from './ops.ts';
import { ops2 } from './ops2.ts';
import { ops3 } from './ops3.ts';
import { shell } from './shell.ts';
import { site } from './site.ts';
import { admin } from './admin.ts';
import { desk } from './desk.ts';
import { teams } from './teams.ts';

export const AREAS = { reliability, timing, completion, common, shell, auth, account, entries, competition, teams, site, ops, screen, admin, desk, ops2, ops3 } as const;

export const cy: Catalogue = { ...reliability, ...timing, ...completion, ...common, ...shell, ...auth, ...account, ...entries, ...competition, ...teams, ...site, ...ops, ...screen, ...admin, ...desk, ...ops2, ...ops3 };
