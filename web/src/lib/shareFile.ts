/** File support must be checked separately: some browsers share links but cannot share files. */
export function canShareFile(file: File): boolean {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }); }
  catch { return false; }
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Call from a fresh user tap after preparing the file, preserving mobile share activation. */
export async function shareOrDownloadFile(file: File, details: { title?: string; text?: string } = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareFile(file)) {
    try { await navigator.share({ ...details, files: [file] }); return 'shared'; }
    catch (e) { if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError') return 'cancelled'; }
  }
  downloadFile(file);
  return 'downloaded';
}
