import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  narrationStage,
  nextAction,
  promoScript,
  promoDesk,
  reviewStage,
  scriptStage,
  storyboardStage,
} from '../src/frontend/promo-desk.ts';

const brief = (overrides = {}) => ({
  id: 'promo_1', title: 'Fictional promo', revision: 2, aspect: '16:9', targetSeconds: 20,
  scenes: [
    { spoken: 'Open on the desk.', visual: 'Wide desk shot' },
    { spoken: 'Close on the type.', visual: '' },
  ],
  ...overrides,
});

const job = (overrides = {}) => ({
  id: 'gen_1', model: 'studio-voice', kind: 'audio', status: 'saved', prompt: promoScript(brief().scenes),
  aspect: null, durationSeconds: 12, assetId: 'asset_voice', createdAt: 1000,
  costAllocatedMicro: null, costEstimateMicro: 0, error: null, compositionId: undefined, variant: undefined,
  ...overrides,
});
const audio = (overrides = {}) => ({
  id: 'asset_voice', kind: 'audio', title: 'Voice take', caption: null, mime: 'audio/mpeg', bytes: 1200,
  width: null, height: null, durationMs: 12000, sampleRate: 48000, channels: 2, sha256: 'h', source: 'generated',
  createdAt: 1000, file: '/f', download: '/d', ...overrides,
});
const composition = (overrides = {}) => ({
  id: 'comp_1', title: 'Fictional cut', shots: [], totalMs: 20000, audioAssetId: null, audioTracks: [],
  createdAt: 500, updatedAt: 500, ...overrides,
});

test('the script stage reports missing spoken words and the spoken estimate', () => {
  const ready = scriptStage(brief());
  assert.equal(ready.state, 'ready');
  assert.equal(ready.seconds, 3); // eight spoken words at 140 wpm
  const missing = scriptStage(brief({ scenes: [{ spoken: 'Hi there.', visual: '' }, { spoken: '   ', visual: 'x' }, { spoken: '', visual: 'y' }] }));
  assert.equal(missing.state, 'missing');
  assert.deepEqual(missing.missingSpoken, [1, 2]);
  const visualOnly = scriptStage(brief({ scenes: [{ spoken: '', visual: 'a' }, { spoken: '', visual: 'b' }] }));
  assert.equal(visualOnly.visualOnly, true);
  assert.equal(promoScript([{ spoken: ' a ' }, { spoken: '' }, { spoken: 'b' }]), 'a\n\nb');
});

test('narration matches only a Studio Voice job whose saved prompt is exactly this script', () => {
  const script = scriptStage(brief());
  const assets = [audio()];
  // Prompt edited after the handoff: no match, stated as missing.
  assert.equal(narrationStage(script, [job({ prompt: 'edited words' })], assets).state, 'missing');
  // A different model never matches.
  assert.equal(narrationStage(script, [job({ model: 'studio-score' })], assets).state, 'missing');
  // Saved job with a live asset is ready.
  const ready = narrationStage(script, [job()], assets);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.asset.id, 'asset_voice');
  // Pending, failed and unknown jobs are distinct states.
  assert.equal(narrationStage(script, [job({ status: 'running', assetId: null })], assets).state, 'waiting');
  assert.equal(narrationStage(script, [job({ status: 'failed', assetId: null, error: { code: 'provider_execution', message: 'boom' } })], assets).state, 'failed');
  assert.equal(narrationStage(script, [job({ status: 'unknown', assetId: null })], assets).state, 'unknown');
  // A saved job whose output is gone is not readiness.
  assert.equal(narrationStage(script, [job()], []).state, 'missing');
  // Cancelled work is not progress: it counts as missing.
  assert.equal(narrationStage(script, [job({ status: 'cancelled', assetId: null })], assets).state, 'missing');
  // A visual-only brief never asks for narration.
  assert.equal(narrationStage(scriptStage(brief({ scenes: [{ spoken: '', visual: 'a' }, { spoken: '', visual: 'b' }] })), [job()], assets).state, 'not-applicable');
  // The newest saved take wins when several match, and the match is disclosed as ambiguous.
  const newer = narrationStage(script, [job(), job({ id: 'gen_2', createdAt: 2000, assetId: 'asset_two' })], [audio(), audio({ id: 'asset_two', title: 'Second take' })]);
  assert.equal(newer.asset.id, 'asset_two');
  assert.equal(newer.ambiguous, true);
  assert.equal(newer.matchingSaved, 2);
  assert.equal(ready.ambiguous, false);
  assert.equal(ready.matchingSaved, 1);
});

test('the storyboard stage follows the matched narration take and its real renders', () => {
  const narrationReady = { state: 'ready', job: { id: 'gen_1', status: 'saved', assetId: 'asset_voice', error: null }, asset: audio() };
  // Nothing is anchored while narration is missing, waiting or failed.
  assert.equal(storyboardStage({ state: 'missing' }, [composition()], [], []).state, 'blocked');
  assert.equal(storyboardStage({ state: 'waiting', job: { id: 'g', status: 'running', assetId: null, error: null } }, [composition()], [], []).state, 'blocked');
  // A visual-only brief is unlinked, not blocked.
  assert.equal(storyboardStage({ state: 'not-applicable' }, [composition()], [], []).state, 'unlinked');
  // No storyboard uses the take yet.
  assert.equal(storyboardStage(narrationReady, [composition()], [], [audio()]).state, 'missing');
  // The take is used as a track: saved, no render yet.
  const using = composition({ audioTracks: [{ assetId: 'asset_voice', role: 'voice', startMs: 0, trimStartMs: 0, trimEndMs: 0, gainDb: 0, fadeInMs: 0, fadeOutMs: 0 }] });
  assert.equal(storyboardStage(narrationReady, [using], [], [audio()]).state, 'not-rendered');
  // The mixed bed also counts.
  assert.equal(storyboardStage(narrationReady, [composition({ audioAssetId: 'asset_voice' })], [], [audio()]).state, 'not-rendered');
  // A pending render is waiting; a failed one is failed; an unknown one is unknown.
  const render = (overrides = {}) => job({ id: 'gen_r', model: 'fal-ffmpeg', compositionId: 'comp_1', assetId: null, ...overrides });
  assert.equal(storyboardStage(narrationReady, [using], [render({ status: 'running' })], [audio()]).state, 'waiting');
  assert.equal(storyboardStage(narrationReady, [using], [render({ status: 'failed', error: { code: 'x', message: 'bad' } })], [audio()]).state, 'failed');
  assert.equal(storyboardStage(narrationReady, [using], [render({ status: 'unknown' })], [audio()]).state, 'unknown');
  // A saved render with a live cut is ready; stale only when the storyboard changed later.
  const cut = audio({ id: 'asset_cut', kind: 'video', title: 'Fictional cut', mime: 'video/mp4', durationMs: 20000 });
  const savedRender = render({ status: 'saved', assetId: 'asset_cut', createdAt: 900 });
  const ready = storyboardStage(narrationReady, [using], [savedRender], [audio(), cut]);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.stale, false);
  assert.equal(ready.ambiguous, false);
  const stale = storyboardStage(narrationReady, [composition({ audioTracks: [{ assetId: 'asset_voice', role: 'voice' }], updatedAt: 1200 }), using], [savedRender], [audio(), cut]);
  assert.equal(stale.state, 'ready');
  assert.equal(stale.stale, true);
  // Several storyboards use the same take: the newest is shown, but the cut is not a certain match.
  const ambiguous = storyboardStage(narrationReady, [using, composition({ id: 'comp_2', audioAssetId: 'asset_voice', updatedAt: 400 })], [savedRender], [audio(), cut]);
  assert.equal(ambiguous.state, 'ready');
  assert.equal(ambiguous.ambiguous, true);
  // A take chosen from several exact-script candidates also makes the cut inferred.
  const ambiguousTake = storyboardStage({ ...narrationReady, ambiguous: true, matchingSaved: 2 }, [using], [savedRender], [audio(), cut]);
  assert.equal(ambiguousTake.state, 'ready');
  assert.equal(ambiguousTake.ambiguous, true);
  // A saved render whose cut left the library is not readiness.
  assert.equal(storyboardStage(narrationReady, [using], [savedRender], [audio()]).state, 'missing');
});

const room = (overrides = {}) => ({
  id: 'room_1', assetId: 'asset_cut', versionLabel: 'Fictional cut', status: 'open',
  decision: null, unresolvedCount: 0, feedbackCount: 0, ...overrides,
});

test('the review stage reads only current rooms pinned to the rendered cut', () => {
  const readyStoryboard = { state: 'ready', composition: composition(), job: { id: 'g', status: 'saved', assetId: 'asset_cut', error: null }, cut: audio({ id: 'asset_cut' }), stale: false, extraCompositions: 0, ambiguous: false };
  assert.equal(reviewStage({ state: 'missing' }, [room()], false).state, 'blocked');
  assert.equal(reviewStage(readyStoryboard, [], false).state, 'missing');
  // A null list is still loading, not the same fact as no room.
  assert.equal(reviewStage(readyStoryboard, null, false).state, 'loading');
  assert.equal(reviewStage(readyStoryboard, null, true).state, 'unavailable');
  assert.equal(reviewStage(readyStoryboard, [room({ assetId: 'asset_other' })], false).state, 'missing');
  assert.equal(reviewStage(readyStoryboard, [room({ decision: 'changes_requested' })], false).state, 'changes');
  assert.equal(reviewStage(readyStoryboard, [room({ decision: 'approved' })], false).state, 'approved');
  assert.equal(reviewStage(readyStoryboard, [room({ unresolvedCount: 2 })], false).state, 'unresolved');
  assert.equal(reviewStage(readyStoryboard, [room()], false).state, 'open');
  // A revoked room is history, even when it once recorded an approval.
  assert.equal(reviewStage(readyStoryboard, [room({ status: 'revoked' })], false).state, 'missing');
  const revokedApproval = reviewStage(readyStoryboard, [room({ status: 'revoked', decision: 'approved' })], false);
  assert.equal(revokedApproval.state, 'missing');
  assert.equal(revokedApproval.revokedCount, 1);
  // A cut that predates later storyboard edits cannot carry this brief's approval.
  assert.equal(reviewStage({ ...readyStoryboard, stale: true }, [room({ decision: 'approved' })], false).state, 'stale');
  // An ambiguous take/cut match keeps the room but never presents it as this brief's approval.
  assert.equal(reviewStage({ ...readyStoryboard, ambiguous: true }, [room({ decision: 'approved' })], false).state, 'ambiguous');
  // Changes requested outrank an older approval on the same cut.
  assert.equal(reviewStage(readyStoryboard, [room({ decision: 'approved' }), room({ id: 'room_2', decision: 'changes_requested' })], false).state, 'changes');
});

test('the next action is the first actionable stage, with exact deep links', () => {
  const projectId = 'proj_1';
  const script = scriptStage(brief());
  // Missing input comes first.
  const missingScript = nextAction(scriptStage(brief({ scenes: [{ spoken: '', visual: '' }, { spoken: 'x', visual: '' }] })), { state: 'missing' }, { state: 'blocked', because: 'narration' }, { state: 'blocked' }, projectId);
  assert.match(missingScript.text, /scene 1/);
  // Script ready -> record narration (no link; the control is on this page).
  assert.match(nextAction(script, { state: 'missing' }, { state: 'blocked', because: 'narration' }, { state: 'blocked' }, projectId).text, /Studio Voice/);
  // Waiting and failed jobs link to History.
  assert.equal(nextAction(script, { state: 'waiting', job: { id: 'g', status: 'running', assetId: null, error: null } }, { state: 'blocked', because: 'narration' }, { state: 'blocked' }, projectId).link.href, '#/p/proj_1/history');
  assert.equal(nextAction(script, { state: 'failed', job: { id: 'g', status: 'failed', assetId: null, error: null } }, { state: 'blocked', because: 'narration' }, { state: 'blocked' }, projectId).link.href, '#/p/proj_1/history');
  // Saved narration without a storyboard.
  const narrationReady = { state: 'ready', job: { id: 'g', status: 'saved', assetId: 'asset_voice', error: null }, asset: audio() };
  assert.match(nextAction(script, narrationReady, { state: 'missing' }, { state: 'blocked' }, projectId).text, /storyboard/);
  // Saved cut, no rooms: create a review link.
  const readyStoryboard = { state: 'ready', composition: composition(), job: { id: 'g', status: 'saved', assetId: 'asset_cut', error: null }, cut: audio({ id: 'asset_cut' }), stale: false, extraCompositions: 0, ambiguous: false };
  assert.equal(nextAction(script, narrationReady, readyStoryboard, { state: 'missing' }, projectId).link.href, '#/p/proj_1/review');
  // Rooms still loading are not "missing", and never claim a cut is ready to share.
  const loading = nextAction(script, narrationReady, readyStoryboard, { state: 'loading' }, projectId);
  assert.match(loading.text, /still loading/);
  assert.doesNotMatch(loading.text, /ready to share/);
  // A stale cut outranks review: render again first.
  assert.match(nextAction(script, narrationReady, { ...readyStoryboard, stale: true }, { state: 'approved', roomCount: 1 }, projectId).text, /changed since this cut/);
  // Approval points at the existing Publish tab, and says it is feedback only.
  const approved = nextAction(script, narrationReady, readyStoryboard, { state: 'approved', roomCount: 1 }, projectId);
  assert.equal(approved.link.href, '#/p/proj_1/publish');
  assert.match(approved.text, /feedback only/);
  // An ambiguous cut match is checked, never presented as this brief's approval.
  const ambiguous = nextAction(script, narrationReady, { ...readyStoryboard, ambiguous: true }, { state: 'ambiguous', roomCount: 1 }, projectId);
  assert.match(ambiguous.text, /one of several possible matches/);
  assert.match(ambiguous.text, /not treated as approval/);
  assert.equal(ambiguous.link.href, '#/p/proj_1/review');
  // The fallback is an inspect/continue state, not a share claim.
  const fallback = nextAction(script, narrationReady, readyStoryboard, { state: 'unexpected' }, projectId);
  assert.match(fallback.text, /No exact linked cut is confirmed/);
  assert.match(fallback.text, /History/);
  assert.doesNotMatch(fallback.text, /ready to share/);
  assert.equal(fallback.link.href, '#/p/proj_1/history');
});

test('the composed desk keeps missing input, waiting, failed, loading and ready distinct', () => {
  const full = promoDesk(brief(), [audio()], [composition({ audioAssetId: 'asset_voice', updatedAt: 500 })],
    [job(), job({ id: 'gen_r', model: 'fal-ffmpeg', compositionId: 'comp_1', status: 'failed', assetId: null, error: { code: 'provider_execution', message: 'provider refused' }, createdAt: 900 })],
    null, false, 'proj_1');
  assert.equal(full.script.state, 'ready');
  assert.equal(full.narration.state, 'ready');
  assert.equal(full.storyboard.state, 'failed');
  assert.equal(full.review.state, 'blocked');
  assert.match(full.next.text, /failed/);
  // A ready cut with the room read still in flight is loading, not "no room".
  const cut = audio({ id: 'asset_cut', kind: 'video', title: 'Fictional cut', mime: 'video/mp4' });
  const loading = promoDesk(brief(), [audio(), cut], [composition({ audioAssetId: 'asset_voice', updatedAt: 500 })],
    [job(), job({ id: 'gen_r', model: 'fal-ffmpeg', compositionId: 'comp_1', status: 'saved', assetId: 'asset_cut', createdAt: 900 })],
    null, false, 'proj_1');
  assert.equal(loading.storyboard.state, 'ready');
  assert.equal(loading.storyboard.ambiguous, false);
  assert.equal(loading.review.state, 'loading');
  assert.match(loading.next.text, /still loading/);
  assert.doesNotMatch(loading.next.text, /ready to share/);
});
