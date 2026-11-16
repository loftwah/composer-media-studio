// MIT. One source of truth for the Director's visible identity.
//
// The product is neutral by default. A standalone or white-label studio must
// work without inventing a character, so the role is always "Creative
// Director" and an installation name is optional. The name can arrive from the
// server shell (`DIRECTOR_NAME`, published as `<meta name="studio-director-name">`)
// or from a build (`VITE_DIRECTOR_NAME`); a runtime value wins over a build
// value. Nothing here enters the model prompt or leaves the browser.

export const DIRECTOR_ROLE = 'Creative Director';
export const DIRECTOR_NAME_LIMIT = 40;
const EMPTY_NAMES = new Set(['undefined', 'null', 'false', 'none']);

export type DirectorIdentity = {
  /** Optional installation name, already normalised, or null. */
  name: string | null;
  /** The neutral role, independent of any installation name. */
  role: string;
  /** Visible panel title: "Nova — your Creative Director" or "Creative Director". */
  title: string;
  /** Tight-space label: "Nova" or "Creative Director". */
  shortTitle: string;
  /** Sentence subject: "Nova" or "The Creative Director". */
  subject: string;
  /** Mid-sentence reference: "Nova" or "the Creative Director". */
  reference: string;
};

/** Normalise an installation name without ever inventing one. */
export function normalizeDirectorName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const plain = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = Array.from(plain).slice(0, DIRECTOR_NAME_LIMIT).join('').trim();
  if (!name || EMPTY_NAMES.has(name.toLowerCase())) return null;
  // "Creative Director — your Creative Director" is not an identity.
  if (name.toLowerCase() === DIRECTOR_ROLE.toLowerCase()) return null;
  return name;
}

export function directorIdentityFor(name: unknown): DirectorIdentity {
  const resolved = normalizeDirectorName(name);
  return {
    name: resolved,
    role: DIRECTOR_ROLE,
    title: resolved ? `${resolved} — your ${DIRECTOR_ROLE}` : DIRECTOR_ROLE,
    shortTitle: resolved ?? DIRECTOR_ROLE,
    subject: resolved ?? `The ${DIRECTOR_ROLE}`,
    reference: resolved ?? `the ${DIRECTOR_ROLE}`,
  };
}

function configuredName(): string | null {
  const meta = typeof document === 'undefined'
    ? null
    : document.querySelector('meta[name="studio-director-name"]')?.getAttribute('content') ?? null;
  // Vite substitutes this at build time. In plain Node `import.meta.env` is
  // absent, so the optional chain keeps this module import-safe for checks.
  const build = import.meta.env?.VITE_DIRECTOR_NAME ?? null;
  return normalizeDirectorName(meta) ?? normalizeDirectorName(build);
}

export const directorIdentity = directorIdentityFor(configuredName());
