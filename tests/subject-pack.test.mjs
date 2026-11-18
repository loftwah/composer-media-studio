import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubjectPack, readSubjectPack } from '../src/frontend/subject-pack.ts';
const subject = { id:'sub_test', revision:2, type:'person', name:'Example', traits:'Blue coat', referenceRole:'face', referenceSha256:'a'.repeat(64), referenceAssetId:'asset_private', apiKey:'secret' };
test('pack exports only intentional metadata and imports an unconfirmed blank local reference', () => {
  const pack = createSubjectPack(subject);
  assert.doesNotMatch(JSON.stringify(pack), /secret|asset_private|apiKey/);
  assert.deepEqual(readSubjectPack(pack), { type:'person', name:'Example', traits:'Blue coat', referenceRole:'face', referenceAssetId:'', rightsConfirmed:false });
});
test('v1 serialized bytes are unchanged', () => {
  assert.equal(JSON.stringify(createSubjectPack(subject)), '{"format":"media-studio-subject-pack","version":1,"subject":{"type":"person","name":"Example","traits":"Blue coat","referenceRole":"face"},"source":{"subjectId":"sub_test","revision":2,"referenceSha256":"' + 'a'.repeat(64) + '"}}');
});
test('rejects malformed, extended, legacy and oversized fields', () => {
  const pack = createSubjectPack(subject);
  for (const invalid of [null, {}, { ...pack, token:'secret' }, { ...pack, version:2 }, { ...pack, rightsConfirmed:true }, { ...pack, source: { ...pack.source, referenceSha256:'x' } }, { ...pack, source: { ...pack.source, revision:'2' } }, { ...pack, subject: { ...pack.subject, name:'x'.repeat(81) } }, { ...pack, subject: { ...pack.subject, traits:'x'.repeat(1201) } }, { format:'media-studio-subject', version:0, subject:pack.subject, source:pack.source }, { format:'media-studio-subject-pack', version:1, subject:pack.subject }]) assert.throws(() => readSubjectPack(invalid));
});
