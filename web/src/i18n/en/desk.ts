import type { Message } from '../messages';
import { deskCommentary } from './desk-parts/commentary.ts';
import { deskStream } from './desk-parts/stream.ts';

/** Parts live in desk-parts/ so several people can work on them at once; the keys all start `desk.`. */
export const desk = {
  ...deskCommentary,
  ...deskStream,
} satisfies Record<string, Message>;
