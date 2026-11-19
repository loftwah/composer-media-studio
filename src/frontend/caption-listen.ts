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

// Use the original song clock. A manual pause or seek ends a bounded audition.
export async function listenFromCaption(player: HTMLMediaElement, startMs: number, durationMs: number, signal: AbortSignal, endMs?: number): Promise<void> {
  if (!Number.isSafeInteger(startMs) || !Number.isFinite(durationMs) || startMs < 0 || startMs >= durationMs) throw new Error('Invalid caption start');
  if (endMs !== undefined && (!Number.isSafeInteger(endMs) || endMs <= startMs || endMs > durationMs)) throw new Error('Invalid caption end');
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
  if (endMs !== undefined && endMs / 1000 > player.duration + 0.05) throw new Error('Caption end exceeds the audio duration');
  const stop = () => player.pause();
  signal.addEventListener('abort', stop, { once: true });
  try { await player.play(); } finally { signal.removeEventListener('abort', stop); }
  if (endMs === undefined || signal.aborted || player.paused) return;
  const bound = endMs / 1000;
  if (player.currentTime >= bound) {
    player.pause();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      player.removeEventListener('timeupdate', reached);
      player.removeEventListener('pause', paused);
      player.removeEventListener('seeking', done);
      player.removeEventListener('ended', done);
      player.removeEventListener('error', failed);
      signal.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve();
    };
    const reached = () => {
      if (player.currentTime < bound) return;
      player.pause();
      finish();
    };
    const done = () => finish();
    const paused = () => { if (player.paused) done(); };
    const failed = () => finish(new Error('Audio could not play'));
    const cancelled = () => {
      player.pause();
      finish(new DOMException('Cancelled', 'AbortError'));
    };
    player.addEventListener('timeupdate', reached);
    player.addEventListener('pause', paused);
    player.addEventListener('seeking', done);
    player.addEventListener('ended', done);
    player.addEventListener('error', failed);
    signal.addEventListener('abort', cancelled);
    if (signal.aborted) cancelled();
  });
}
