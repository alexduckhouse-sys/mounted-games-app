import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogoError, prepareLogo } from './sponsorLogo';

const png = (name = 'logo.png', type = 'image/png') => new File(['x'], name, { type });

let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let drawn: { width: number; height: number }[];
let encoded: { size: number; type: string }[];
const context = { drawImage: vi.fn() };

beforeEach(() => {
  bitmap = { width: 2000, height: 1000, close: vi.fn() };
  drawn = [];
  encoded = [{ size: 1000, type: 'image/webp' }];
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    drawn.push({ width: this.width, height: this.height });
    const next = encoded[Math.min(drawn.length - 1, encoded.length - 1)];
    callback(next ? ({ size: next.size, type: next.type } as Blob) : null);
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('prepareLogo', () => {
  it('shrinks the picture to 512 pixels on its longest side and writes a WebP', async () => {
    const blob = await prepareLogo(png());
    expect(drawn).toEqual([{ width: 512, height: 256 }]);
    expect(blob.type).toBe('image/webp');
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 512, 256);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('never enlarges a small picture', async () => {
    bitmap.width = 100; bitmap.height = 60;
    await prepareLogo(png());
    expect(drawn).toEqual([{ width: 100, height: 60 }]);
  });

  it('tries smaller sizes until it fits in 200 KB', async () => {
    encoded = [{ size: 300 * 1024, type: 'image/webp' }, { size: 250 * 1024, type: 'image/webp' }, { size: 100 * 1024, type: 'image/webp' }];
    const blob = await prepareLogo(png());
    expect(drawn.map((d) => d.width)).toEqual([512, 384, 256]);
    expect(blob.size).toBe(100 * 1024);
  });

  it('accepts the PNG a browser without WebP writing hands back, but nothing else', async () => {
    encoded = [{ size: 5000, type: 'image/png' }];
    expect((await prepareLogo(png('logo.webp', 'image/webp'))).type).toBe('image/png');
    encoded = [{ size: 5000, type: 'image/gif' }];
    await expect(prepareLogo(png())).rejects.toThrow('too detailed');
  });

  it('gives up with a plain message when it can never fit, or the browser cannot write', async () => {
    encoded = [{ size: 900 * 1024, type: 'image/webp' }];
    await expect(prepareLogo(png())).rejects.toBeInstanceOf(LogoError);
    expect(drawn).toHaveLength(4);
    expect(bitmap.close).toHaveBeenCalled();

    encoded = [];
    await expect(prepareLogo(png())).rejects.toThrow('too detailed');
  });

  it('refuses SVG and other types without reading them', async () => {
    await expect(prepareLogo(png('logo.svg', 'image/svg+xml'))).rejects.toThrow('Choose a PNG, JPEG or WebP picture.');
    await expect(prepareLogo(png('logo.gif', 'image/gif'))).rejects.toBeInstanceOf(LogoError);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('says so when the picture cannot be read or there is no canvas', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad image'); }));
    await expect(prepareLogo(png())).rejects.toThrow('couldn’t be read');

    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(prepareLogo(png())).rejects.toThrow('can’t resize');
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('copes with a browser whose bitmaps cannot be closed', async () => {
    bitmap = { width: 10, height: 10, close: undefined as never };
    await expect(prepareLogo(png())).resolves.toBeInstanceOf(Object);
  });
});
