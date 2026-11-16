/**
 * Mediabunny throws `UnsupportedInputFormatError` when a file cannot be parsed
 * at all. The local tools promise an actionable refusal, so translate the first
 * probe instead of showing parser text such as "Input has an unsupported or
 * unrecognizable format." to the creator. A missing track still returns null.
 */
export async function probeMediaTrack<T>(
  probe: () => Promise<T | null>,
  kind: "audio" | "video",
): Promise<T | null> {
  try {
    return await probe();
  } catch {
    throw new Error(
      kind === "video"
        ? "This browser cannot read that video. Try another MP4 or WebM."
        : "This browser cannot decode that audio file.",
    );
  }
}
