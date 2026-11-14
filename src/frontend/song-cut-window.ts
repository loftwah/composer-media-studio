/** A listening window around an internal, contiguous draft cut on the source-song clock. */
export function songCutWindow(scenes:{startMs:number;endMs:number}[], index:number, startMs:number, endMs:number, durationMs:number|null) {
  const scene=scenes[index],next=scenes[index+1];
  if (!scene || !next || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || !Number.isSafeInteger(durationMs) || !Number.isSafeInteger(scene.startMs) || !Number.isSafeInteger(scene.endMs) || !Number.isSafeInteger(next.startMs) || !Number.isSafeInteger(next.endMs) || next.startMs!==scene.endMs || scene.startMs<startMs || scene.startMs>=scene.endMs || next.endMs<=next.startMs || next.endMs>endMs || startMs<0 || endMs>durationMs! || scene.endMs<=startMs || scene.endMs>=endMs) return null;
  return {startMs:Math.max(startMs,scene.endMs-2000),endMs:Math.min(endMs,scene.endMs+2000)};
}
