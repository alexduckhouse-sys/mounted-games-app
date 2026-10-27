import type { Message } from '../messages';
import { account } from './account';
import { auth } from './auth';
import { common } from './common';
import { competition } from './competition';
import { entries } from './entries';
import { shell } from './shell';
import { teams } from './teams';

/** The areas of the catalogue, one file each. Keys are `area.thing`; an area never reuses another's prefix. */
export const AREAS = { common, shell, auth, account, entries, competition, teams } as const;

/**
 * English is the source language and the fallback for everything missing from Welsh or French. Where a string
 * moved here from a component it is byte-identical to what the component showed, so tests that read English keep
 * passing.
 */
export const en = { ...common, ...shell, ...auth, ...account, ...entries, ...competition, ...teams } satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;
/** A non-English catalogue: any subset of the English keys. */
export type Catalogue = Partial<Record<MessageKey, Message>>;
