// MIT. Portable subject text with the saved revision and reference fingerprint.

const types: readonly string[] = ['person', 'product', 'location', 'style', 'source_frame'];
/** Supported reference roles, in the original declaration order. */
const roles: readonly string[] = ['face', 'full_body', 'profile', 'costume', 'prop', 'location', 'style', 'source_frame'];

/** The portable subset of a saved subject the exporter is allowed to read. */
interface PackSubject {
  id: string;
  revision: number;
  type: string;
  name: string;
  traits: string;
  referenceRole: string;
  referenceSha256: string;
}

/** The v1 pack. Only the four intended keys, in the original key order. */
interface SubjectPack {
  format: 'media-studio-subject-pack';
  version: 1;
  subject: {
    type: string;
    name: string;
    traits: string;
    referenceRole: string;
  };
  source: {
    subjectId: string;
    revision: number;
    referenceSha256: string;
  };
}

/** A checked import: blank local reference and unconfirmed rights. */
interface ImportedSubject {
  type: string;
  name: string;
  traits: string;
  referenceRole: string;
  referenceAssetId: '';
  rightsConfirmed: false;
}

/** Exact-key object guard, matching the original runtime check. */
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Export the portable metadata only; no media, permissions or secrets. */
export function createSubjectPack(subject: PackSubject): SubjectPack {
  return {
    format: 'media-studio-subject-pack',
    version: 1,
    subject: {
      type: subject.type,
      name: subject.name,
      traits: subject.traits,
      referenceRole: subject.referenceRole,
    },
    source: {
      subjectId: subject.id,
      revision: subject.revision,
      referenceSha256: subject.referenceSha256,
    },
  };
}

/** Validate a v1 pack and import it as an unconfirmed, reference-less draft. */
export function readSubjectPack(input: unknown): ImportedSubject {
  const fail = (): never => { throw new Error('This is not a supported subject pack.'); };
  if (!exact(input, ['format', 'version', 'subject', 'source'])) return fail();
  if (input.format !== 'media-studio-subject-pack' || input.version !== 1) return fail();
  const subject = input.subject;
  const source = input.source;
  if (!exact(subject, ['type', 'name', 'traits', 'referenceRole'])) return fail();
  if (!exact(source, ['subjectId', 'revision', 'referenceSha256'])) return fail();
  if (
    typeof subject.type !== 'string' || !types.includes(subject.type) ||
    typeof subject.referenceRole !== 'string' || !roles.includes(subject.referenceRole) ||
    typeof subject.name !== 'string' || !subject.name.trim() || subject.name.length > 80 ||
    typeof subject.traits !== 'string' || subject.traits.length > 1200 ||
    typeof source.subjectId !== 'string' || !/^sub_[a-z0-9_]{1,80}$/.test(source.subjectId) ||
    typeof source.revision !== 'number' || !Number.isSafeInteger(source.revision) || source.revision < 1 ||
    typeof source.referenceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.referenceSha256)
  ) return fail();
  return {
    type: subject.type,
    name: subject.name,
    traits: subject.traits,
    referenceRole: subject.referenceRole,
    referenceAssetId: '',
    rightsConfirmed: false,
  };
}
