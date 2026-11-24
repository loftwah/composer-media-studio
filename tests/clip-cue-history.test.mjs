import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_CUE_HISTORY,
  cueEditHistory,
  redoLastCueChange,
  undoLastCueChange,
} from '../src/frontend/clip-cue-history.ts';

const draft = (name, digest, text) => ({
  name,
  sourceSha256: digest,
  cues: [{ startMs: 0, endMs: 1000, text, speaker: '' }],
  local: true,
});

const before = draft('captions.srt', 'a'.repeat(64), 'Before');
const after = draft('captions-edited.vtt', 'b'.repeat(64), 'After');

test('undo and redo exchange the exact draft objects, names and digests', () => {
  const edited = cueEditHistory(before);
  assert.equal(edited.undo, before);
  assert.equal(edited.redo, null);

  const undone = undoLastCueChange(edited, after);
  assert.equal(undone.draft, before);
  assert.equal(undone.history.undo, null);
  assert.equal(undone.history.redo.draft, after);

  const redone = redoLastCueChange(undone.history, undone.draft);
  assert.equal(redone.draft, after);
  assert.equal(redone.draft.name, 'captions-edited.vtt');
  assert.equal(redone.draft.sourceSha256, 'b'.repeat(64));
  assert.equal(redone.history.undo, before);
  assert.equal(redone.history.redo, null);

  // One step in each direction: toggling again restores the same objects.
  const again = undoLastCueChange(redone.history, redone.draft);
  assert.equal(again.draft, before);
  assert.equal(again.history.redo.draft, after);
});

test('removing the final cue round-trips through a null draft', () => {
  const removed = cueEditHistory(before);
  const undone = undoLastCueChange(removed, null);
  assert.equal(undone.draft, before);
  assert.equal(undone.history.redo.draft, null);

  const redone = redoLastCueChange(undone.history, undone.draft);
  assert.equal(redone.draft, null);
  assert.equal(redone.history.undo, before);
  assert.equal(redone.history.redo, null);
});

test('undo and redo restore a named cue speaker unchanged', () => {
  const named = cue => ({ ...cue, cues: [{ ...cue.cues[0], speaker: 'Dean & Jane' }] });
  const namedBefore = named(before), namedAfter = named(after);
  const undone = undoLastCueChange(cueEditHistory(namedBefore), namedAfter);
  assert.equal(undone.draft, namedBefore);
  assert.equal(undone.draft.cues[0].speaker, 'Dean & Jane');
  const redone = redoLastCueChange(undone.history, undone.draft);
  assert.equal(redone.draft, namedAfter);
  assert.equal(redone.draft.cues[0].speaker, 'Dean & Jane');
});

test('a successful new edit or a source reset discards the old redo branch', () => {
  const undone = undoLastCueChange(cueEditHistory(before), after);
  assert.ok(undone.history.redo);

  const newer = cueEditHistory(undone.draft);
  assert.equal(newer.redo, null);
  assert.equal(redoLastCueChange(newer, before), null);

  assert.equal(EMPTY_CUE_HISTORY.undo, null);
  assert.equal(EMPTY_CUE_HISTORY.redo, null);
  assert.equal(undoLastCueChange(EMPTY_CUE_HISTORY, before), null);
  assert.equal(redoLastCueChange(EMPTY_CUE_HISTORY, before), null);
});
