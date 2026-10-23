import { fitWithin, LOGO_MAX_BYTES, LOGO_MAX_PIXELS, LOGO_TYPES } from '../../lib/sponsors';

/** A problem the organiser can fix, worded for them. */
export class LogoError extends Error {}

const SIZES = [LOGO_MAX_PIXELS, 384, 256, 160];

/**
 * Shrinks a chosen picture in the browser so it fits the API's limits (png, jpeg or webp, 200 KB): no side
 * longer than 512 pixels, and smaller steps if the file is still too big. Transparent areas are kept.
 * SVG is refused, as it is by the API.
 */
export async function prepareLogo(file: File): Promise<Blob> {
  if (!LOGO_TYPES.includes(file.type)) throw new LogoError('Choose a PNG, JPEG or WebP picture.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new LogoError('That picture couldn’t be read. Try another.');
  }
  try {
    for (const longest of SIZES) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, longest);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new LogoError('This browser can’t resize pictures.');
      context.drawImage(bitmap, 0, 0, width, height);
      // Browsers that can't write WebP hand back a PNG, which is also allowed.
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
      if (blob && LOGO_TYPES.includes(blob.type) && blob.size <= LOGO_MAX_BYTES) return blob;
    }
  } finally {
    bitmap.close?.();
  }
  throw new LogoError('That logo is too detailed to shrink to 200 KB. Try a simpler picture.');
}
