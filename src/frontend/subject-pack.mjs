const types = ['person', 'product', 'location', 'style', 'source_frame'];
const roles = ['face', 'full_body', 'profile', 'costume', 'prop', 'location', 'style', 'source_frame'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function createSubjectPack(subject) {
  return { format: 'media-studio-subject-pack', version: 1, subject: { type: subject.type, name: subject.name, traits: subject.traits, referenceRole: subject.referenceRole }, source: { subjectId: subject.id, revision: subject.revision, referenceSha256: subject.referenceSha256 } };
}
export function readSubjectPack(input) {
  const fail = () => { throw new Error('This is not a supported subject pack.'); };
  if (!exact(input, ['format', 'version', 'subject', 'source']) || input.format !== 'media-studio-subject-pack' || input.version !== 1 || !exact(input.subject, ['type', 'name', 'traits', 'referenceRole']) || !exact(input.source, ['subjectId', 'revision', 'referenceSha256'])) fail();
  const s = input.subject, source = input.source;
  if (!types.includes(s.type) || !roles.includes(s.referenceRole) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80 || typeof s.traits !== 'string' || s.traits.length > 1200 || typeof source.subjectId !== 'string' || !/^sub_[a-z0-9_]{1,80}$/.test(source.subjectId) || !Number.isSafeInteger(source.revision) || source.revision < 1 || typeof source.referenceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.referenceSha256)) fail();
  return { type: s.type, name: s.name, traits: s.traits, referenceRole: s.referenceRole, referenceAssetId: '', rightsConfirmed: false };
}
