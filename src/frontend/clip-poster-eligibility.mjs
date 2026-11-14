export function clipPosterError(player) {
  if (!player || !player.paused || player.seeking || player.readyState < 2 || !player.videoWidth || !player.videoHeight) return 'Pause the finished clip and wait for its frame to load, then capture it.';
  if ((player.videoWidth > 1280 || player.videoHeight > 1280 || player.videoWidth * player.videoHeight > 1280 * 720)) return 'This frame is too large to capture here.';
  return '';
}
