function waitFor(player: HTMLMediaElement, event: 'loadedmetadata' | 'seeked', signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Audio preview timed out')), 10000);
    const finish = (error?: Error) => { clearTimeout(timer); player.removeEventListener(event, done); player.removeEventListener('error', failed); signal.removeEventListener('abort', cancelled); error ? reject(error) : resolve(); };
    const done = () => finish();
    const failed = () => finish(new Error('Audio could not load'));
    const cancelled = () => finish(new DOMException('Cancelled', 'AbortError'));
    player.addEventListener(event, done, { once: true });
    player.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}

// Seek against the original song clock, not the segment-relative export clock.
export async function listenFromCaption(player: HTMLMediaElement, startMs: number, durationMs: number, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(startMs) || !Number.isFinite(durationMs) || startMs < 0 || startMs >= durationMs) throw new Error('Invalid caption start');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (player.readyState < 1) { const ready = waitFor(player, 'loadedmetadata', signal); player.load(); await ready; }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const target = startMs / 1000;
  if (!Number.isFinite(player.duration) || target >= player.duration || !Array.from({ length: player.seekable.length }, (_, i) => target >= player.seekable.start(i) && target < player.seekable.end(i)).some(Boolean)) throw new Error('Caption start is not seekable');
  if (Math.abs(player.currentTime - target) > 0.001) {
    player.currentTime = target;
    if (player.seeking) await waitFor(player, 'seeked', signal);
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (Math.abs(player.currentTime - target) > 0.05) throw new Error('Audio did not seek to caption');
  const stop = () => player.pause();
  signal.addEventListener('abort', stop, { once: true });
  try { await player.play(); } finally { signal.removeEventListener('abort', stop); }
}
