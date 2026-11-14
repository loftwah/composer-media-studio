import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubjectPack, readSubjectPack } from '../src/frontend/subject-pack.mjs';
const subject = { id:'sub_test', revision:2, type:'person', name:'Example', traits:'Blue coat', referenceRole:'face', referenceSha256:'a'.repeat(64), referenceAssetId:'asset_private', apiKey:'secret' };
test('pack exports only intentional metadata and imports an unconfirmed blank local reference', () => {
  const pack = createSubjectPack(subject);
  assert.doesNotMatch(JSON.stringify(pack), /secret|asset_private|apiKey/);
  assert.deepEqual(readSubjectPack(pack), { type:'person', name:'Example', traits:'Blue coat', referenceRole:'face', referenceAssetId:'', rightsConfirmed:false });
});
test('rejects malformed, extended and oversized fields', () => {
  const pack = createSubjectPack(subject);
  for (const invalid of [null, {}, { ...pack, token:'secret' }, { ...pack, version:2 }, { ...pack, source: { ...pack.source, referenceSha256:'x' } }, { ...pack, subject: { ...pack.subject, name:'x'.repeat(81) } }, { ...pack, subject: { ...pack.subject, traits:'x'.repeat(1201) } }]) assert.throws(() => readSubjectPack(invalid));
});
