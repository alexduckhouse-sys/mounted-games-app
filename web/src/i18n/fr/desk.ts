import type { AreaCatalogue } from '../messages';
import type { desk as en } from '../en/desk.ts';
import { deskCommentary } from './desk-parts/commentary.ts';
import { deskStream } from './desk-parts/stream.ts';

export const desk: AreaCatalogue<typeof en> = {
  ...deskCommentary,
  ...deskStream,
};
