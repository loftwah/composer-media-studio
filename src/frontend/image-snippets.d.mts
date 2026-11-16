export type SnippetKind = "base64" | "dataUri" | "css" | "html" | "markdown";

export const MAX_SNIPPET_BYTES: number;
export const SNIPPET_WARN_BYTES: number;
export const SNIPPET_KINDS: ReadonlyArray<SnippetKind>;
export const SNIPPET_LABELS: Readonly<Record<SnippetKind, string>>;

export function escapeSnippetText(value: unknown): string;
export function bytesToBase64(bytes: Uint8Array): string;
export function base64ToBytes(text: string): Uint8Array | null;

export type SnippetResult =
  | {
      ok: true;
      mime: string;
      bytes: number;
      base64Length: number;
      dataUriLength: number;
      snippets: Record<SnippetKind, string>;
      warning: string | null;
    }
  | { ok: false; error: string };

export function buildImageSnippets(input?: {
  bytes?: Uint8Array;
  mime?: string;
  filename?: string;
  width?: number;
  height?: number;
}): SnippetResult;
