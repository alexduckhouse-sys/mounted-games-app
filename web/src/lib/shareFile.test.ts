import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFile, shareOrDownloadFile } from './shareFile';
const file = new File(['demo'], 'demo.webm', { type: 'video/webm' });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('file sharing', () => {
  it('requires explicit file support and handles throwing capability checks', () => {
    vi.stubGlobal('navigator', { share: vi.fn() }); expect(canShareFile(file)).toBe(false);
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => { throw new Error(); } }); expect(canShareFile(file)).toBe(false);
  });
  it('shares a prepared file and treats dismissal as cancellation', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });
    expect(await shareOrDownloadFile(file, { title: 'Demo' })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'Demo' });
    share.mockRejectedValue(new DOMException('Dismissed', 'AbortError'));
    expect(await shareOrDownloadFile(file)).toBe('cancelled');
  });
  it.each([false, true])('downloads when file sharing is unavailable or fails (%s)', async supported => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('unsupported')), canShare: () => supported });
    const create = vi.fn(() => 'blob:demo'), revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await shareOrDownloadFile(file)).toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:demo');
  });
});
