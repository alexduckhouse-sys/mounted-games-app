import { api } from '../../api';
import { problemMessage } from '../../lib/apiError';
import type { CustomEmailImage } from './customEmailTypes';
import { MAX_PICTURE_BYTES, PICTURE_TYPES, type PictureDraft } from './emailDraft';

/** The first picture on a drop or a paste, if there is one. */
export function pictureFrom(data: DataTransfer | null | undefined): File | null {
  const files = [...(data?.files ?? [])];
  return files.find((f) => f.type.startsWith('image/')) ?? files[0] ?? null;
}

/** Checks the file on this device, then uploads it. Throws a message fit to show. */
export async function uploadPicture(file: File): Promise<PictureDraft> {
  if (!PICTURE_TYPES.includes(file.type)) throw new Error('The picture must be a PNG, JPG or WebP image.');
  if (file.size > MAX_PICTURE_BYTES) throw new Error('The picture must be 500 KB or smaller.');
  try {
    const { data } = await api.post<CustomEmailImage>('/admin/custom-email-images', file, { headers: { 'Content-Type': file.type } });
    return { imageId: data.id, url: data.url, name: file.name || 'Pasted picture' };
  } catch (caught) {
    throw new Error(problemMessage(caught, 'Couldn’t upload the picture. Check your signal and try again.'), { cause: caught });
  }
}
