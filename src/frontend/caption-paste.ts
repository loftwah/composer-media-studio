import { MAX_CAPTION_BYTES } from "./clip-captions.ts";

export type CaptionPaste =
  | Readonly<{ file: File }>
  | Readonly<{ problem: string }>;

/**
 * Turn exactly the text in the paste box into the same bounded File the local
 * caption picker accepts. Empty or oversized text is refused before a File is
 * built, and the extension follows the importer's own WebVTT header sniff.
 */
export function captionFileFromText(text: string): CaptionPaste {
  if (typeof text !== "string" || !text.trim()) return { problem: "Paste plain SRT or WebVTT text, then choose Apply." };
  if (text.length > MAX_CAPTION_BYTES) return { problem: "Paste plain SRT or WebVTT text up to 64 KB." };
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_CAPTION_BYTES) return { problem: "Paste plain SRT or WebVTT text up to 64 KB." };
  const vtt = /^WEBVTT(?:\s|$)/.test(text.replace(/^\ufeff/, "").trimStart());
  return {
    file: new File([bytes], `pasted-captions.${vtt ? "vtt" : "srt"}`, {
      type: vtt ? "text/vtt" : "application/x-subrip",
    }),
  };
}
