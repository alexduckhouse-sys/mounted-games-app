/** Decode complete recordings and encode a new, independently playable clip. Never splice container bytes. */
export interface ReplaySource {
  load: () => Promise<Blob>;
  from: number;
  to: number;
}
export interface ReplayTransform { zoom: number; panX: number; panY: number }
export interface ReplayEncodingOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  transform?: (seconds: number, width: number, height: number) => ReplayTransform;
}

export function replayMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
}

function cancelled(): DOMException { return new DOMException('Replay preparation cancelled.', 'AbortError'); }

function mediaReady(video: HTMLVideoElement, event: string, ready: () => boolean, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled());
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown) => {
      clearTimeout(timeout);
      video.removeEventListener(event, loaded);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('This recording could not be decoded. Try another clip.'));
    const aborted = () => finish(cancelled());
    const timeout = setTimeout(() => finish(new Error('The recording took too long to load. Try again.')), 15_000);
    video.addEventListener(event, loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function waitForMedia<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (error: unknown, value?: T) => {
      clearTimeout(timer); signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(value as T);
    };
    const aborted = () => finish(cancelled());
    const timer = setTimeout(() => finish(new Error('Replay preparation took too long. Try again.')), 15_000);
    signal.addEventListener('abort', aborted, { once: true });
    pending.then((value) => finish(null, value), (error) => finish(error));
    if (signal.aborted) aborted();
  });
}

export async function encodeReplay(sources: ReplaySource[], options: ReplayEncodingOptions = {}): Promise<Blob> {
  const mimeType = replayMimeType();
  if (!mimeType || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('This browser cannot prepare replay clips. Try a recent Safari or Chrome.');
  }
  const total = sources.reduce((sum, source) => sum + Math.max(0, source.to - source.from), 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Choose a clip with some video to save.');
  if (options.signal?.aborted) throw cancelled();
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot render replay clips.');
  // Route source audio only to the recording, never to the device speakers.
  const Audio = globalThis.AudioContext;
  if (!Audio) throw new Error('This browser cannot prepare replay audio. Try a recent Safari or Chrome.');
  const audio = new Audio();
  const audioDestination = audio.createMediaStreamDestination();
  const audioSource = audio.createMediaElementSource(video);
  audioSource.connect(audioDestination);
  const audioReady = audio.resume();
  let output: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let sourceUrl: string | undefined;
  let frame = 0;
  const blobs: Blob[] = [];
  let encodedBytes = 0;
  let completed = 0;
  let recordingError: Error | undefined;
  const abort = new AbortController();
  const abortFromCaller = () => abort.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const hidden = () => { if (document.hidden) { recordingError = new Error('Keep this tab open while the clip is prepared.'); abort.abort(); } };
  document.addEventListener('visibilitychange', hidden);
  const check = () => { if (recordingError) throw recordingError; if (abort.signal.aborted) throw cancelled(); };
  try {
    await waitForMedia(audioReady, abort.signal);
    check();
    for (const source of sources) {
      if (source.to <= source.from) continue;
      check();
      const blob = await waitForMedia(source.load(), abort.signal);
      check();
      sourceUrl = URL.createObjectURL(blob);
      video.src = sourceUrl;
      video.load();
      await mediaReady(video, 'loadeddata', () => video.readyState >= 2, abort.signal);
      check();
      if (!output) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) throw new Error('The recording has no video frames.');
        output = canvas.captureStream(30);
        for (const track of audioDestination.stream.getAudioTracks()) output.addTrack(track);
        recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
        recorder.ondataavailable = ({ data }) => {
          if (!data.size) return;
          encodedBytes += data.size;
          if (encodedBytes > 128 * 1024 * 1024) { recordingError = new Error('This clip is too large. Choose a shorter clip.'); abort.abort(); return; }
          blobs.push(data);
        };
        recorder.onerror = () => { recordingError = new Error('The browser could not encode this replay. Try again.'); abort.abort(); };
      }
      video.currentTime = source.from;
      await mediaReady(video, 'seeked', () => !video.seeking, abort.signal);
      check();
      const draw = () => {
        const time = completed + Math.max(0, video.currentTime - source.from);
        const transform = options.transform?.(time, canvas.width, canvas.height) ?? { zoom: 1, panX: 0, panY: 0 };
        context.fillStyle = 'black'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.translate(canvas.width / 2, canvas.height / 2);
        context.scale(transform.zoom, transform.zoom);
        context.translate(-canvas.width / 2 + transform.panX, -canvas.height / 2 + transform.panY);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        context.restore();
        options.onProgress?.(Math.min(1, time / total));
      };
      draw();
      await waitForMedia(video.play(), abort.signal);
      check();
      if (recorder!.state === 'inactive') recorder!.start(1000);
      else recorder!.resume();
      await new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => {
          cancelAnimationFrame(frame); clearTimeout(timeout);
          abort.signal.removeEventListener('abort', aborted);
          video.removeEventListener('error', failed);
          video.removeEventListener('ended', ended);
          if (error) reject(error); else resolve();
        };
        const aborted = () => done(recordingError ?? cancelled());
        const failed = () => done(new Error('Playback failed while preparing the replay.'));
        const ended = () => done();
        const timeout = setTimeout(() => done(new Error('Playback stalled. Try preparing the clip again.')), (source.to - source.from + 15) * 1000);
        const tick = () => {
          try {
            draw();
            if (video.currentTime >= source.to || video.ended) done();
            else frame = requestAnimationFrame(tick);
          } catch (error) { done(error); }
        };
        abort.signal.addEventListener('abort', aborted, { once: true });
        video.addEventListener('error', failed, { once: true });
        video.addEventListener('ended', ended, { once: true });
        frame = requestAnimationFrame(tick);
      });
      recorder!.pause(); video.pause();
      completed += source.to - source.from;
      video.removeAttribute('src'); video.load();
      URL.revokeObjectURL(sourceUrl); sourceUrl = undefined;
    }
    check();
    await waitForMedia(new Promise<void>((resolve, reject) => {
      recorder!.onstop = () => resolve();
      recorder!.onerror = () => reject(new Error('The browser could not finish the replay.'));
      recorder!.stop();
    }), abort.signal);
    check();
    if (!blobs.length) throw new Error('No video was recorded. Try another clip.');
    options.onProgress?.(1);
    return new Blob(blobs, { type: recorder!.mimeType });
  } finally {
    cancelAnimationFrame(frame);
    options.signal?.removeEventListener('abort', abortFromCaller);
    document.removeEventListener('visibilitychange', hidden);
    video.pause(); video.removeAttribute('src'); video.load();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    output?.getTracks().forEach((track) => track.stop());
    audioSource.disconnect();
    await audio.close().catch(() => {});
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
}
