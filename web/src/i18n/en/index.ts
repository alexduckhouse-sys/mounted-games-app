import type { Message } from '../messages';
import { account } from './account.ts';
import { auth } from './auth.ts';
import { common } from './common.ts';
import { competition } from './competition.ts';
import { entries } from './entries.ts';
import { screen } from './screen.ts';
import { ops } from './ops.ts';
import { ops2 } from './ops2.ts';
import { shell } from './shell.ts';
import { site } from './site.ts';
import { admin } from './admin.ts';
import { desk } from './desk.ts';
import { teams } from './teams.ts';

/** The areas of the catalogue, one file each. Keys are `area.thing`; an area never reuses another's prefix. */
export const AREAS = { common, shell, auth, account, entries, competition, teams, site, ops, screen, admin, desk, ops2 } as const;

/**
 * English is the source language and the fallback for everything missing from Welsh or French. Where a string
 * moved here from a component it is byte-identical to what the component showed, so tests that read English keep
 * passing.
 */
export const en = { ...common, ...shell, ...auth, ...account, ...entries, ...competition, ...teams, ...site, ...ops, ...screen, ...admin, ...desk, ...ops2 } satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
/** A non-English catalogue: any subset of the English keys. */
export type Catalogue = Partial<Record<MessageKey, Message>>;
