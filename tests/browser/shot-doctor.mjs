// MIT. Real-browser evidence for the Director's saved-evidence shot diagnosis,
// a reviewed approve/decline save, the same revision identity over the live
// MCP endpoint, and a locally assembled MP4 that actually plays.
// Local wrangler only: no deploy, no model, no paid provider, no production data.

import { ensureFixture } from './fixture.mjs';
import { serve, login, loadPlaywright, ORIGIN, api } from './harness.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/shot-doctor';
await mkdir(`${OUT}/screens`, { recursive: true });
const fixture = await ensureFixture();
const pw = await loadPlaywright();
const server = await serve();
const browser = await pw.chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await login(context);
const page = await context.newPage();
page.on('pageerror', error => console.log('PAGEERROR', error.message.slice(0, 300)));
const receipt = { fixture: { projectId: fixture.projectId, planId: fixture.plan.id }, checks: [], failures: [] };
const check = (name, ok, detail) => {
  receipt.checks.push({ name, ok, detail });
  if (!ok) { receipt.failures.push({ name, detail }); console.log('FAIL', name, detail ?? ''); }
  else console.log('ok  ', name);
};
const planOf = state => state.plans.find(item => item.id === fixture.plan.id);

async function mcpToken() {
  const registered = await context.request.post(`${ORIGIN}/mcp/register`, { data: { client_name: 'Browser fixture agent', redirect_uris: ['http://127.0.0.1:43210/callback'], token_endpoint_auth_method: 'none' } });
  const { client_id } = await registered.json();
  const verifier = 'x'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'http://127.0.0.1:43210/callback', code_challenge: challenge, code_challenge_method: 'S256', resource: `${ORIGIN}/mcp`, scope: 'studio.read', state: 'browser' });
  const consent = await context.request.post(`${ORIGIN}/mcp/authorize`, {
    form: { ...Object.fromEntries(params), project: fixture.projectId, decision: 'allow' },
    headers: { origin: ORIGIN }, maxRedirects: 0,
  });
  check('MCP consent is granted for one fictional project', consent.status() === 303, consent.status());
  const code = new URL(consent.headers().location).searchParams.get('code');
  const exchanged = await context.request.post(`${ORIGIN}/mcp/token`, { form: { grant_type: 'authorization_code', client_id, redirect_uri: 'http://127.0.0.1:43210/callback', code, code_verifier: verifier, resource: `${ORIGIN}/mcp` } });
  const body = await exchanged.json();
  check('a scoped read token is issued', exchanged.status() === 200 && typeof body.access_token === 'string' && body.scope === 'studio.read', JSON.stringify(body));
  return body.access_token;
}

try {
  await page.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
  await page.locator('.song-plan-list').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Fictional six-scene film/ }).click();
  await page.waitForTimeout(700);
  const opening = planOf(await api(context, `/api/projects/${fixture.projectId}/song-plans`));
  const openingHeading = await page.locator('.song-editor-heading p.small').innerText();
  check('the saved plan reopens at its server revision and identity', openingHeading.includes(`Revision ${opening.revision}`) && openingHeading.includes(opening.revisionDigest.slice(0, 12)), openingHeading);

  // 1. Saved-evidence shot diagnosis.
  await page.locator('summary', { hasText: 'Review a scene proposal' }).click();
  await page.locator('summary', { hasText: 'Why is this shot wrong' }).click();
  const doctor = page.locator('details').filter({ hasText: 'Why is this shot wrong' }).last();
  await doctor.getByLabel('Scene 1').check();
  await doctor.getByRole('button', { name: 'Check these shots' }).click();
  await doctor.getByText(/Read plan revision/).waitFor({ timeout: 20_000 });
  const doctorText = await doctor.innerText();
  check('the diagnosis reads the saved plan revision and identity', doctorText.includes(`Read plan revision ${opening.revision}`) && doctorText.includes(opening.revisionDigest.slice(0, 12)), doctorText.slice(0, 180));
  check('the diagnosis cites the saved take hash', /SHA-256 [0-9a-f]{12}/.test(doctorText) && doctorText.includes(fixture.clips[0].sha256.slice(0, 12)), doctorText.slice(0, 400));
  check('the diagnosis answers without submitting work', doctorText.includes('Nothing was submitted, generated or charged'), doctorText.slice(-160));
  await page.screenshot({ path: `${OUT}/screens/1-shot-diagnosis.png` });

  // 2. A typed proposal: decline one change, approve the other, save.
  const proposal = {
    expectedRevision: opening.revision,
    changes: [
      { sceneId: opening.scenes[0].id, direction: 'Approved: hold the wide frame while the fictional light warms.' },
      { sceneId: opening.scenes[1].id, direction: 'Declined: this direction must never be saved.' },
    ],
  };
  const review = page.locator('details').filter({ hasText: 'Review a scene proposal' }).last();
  await review.getByLabel('Proposal JSON').fill(JSON.stringify(proposal));
  await review.getByRole('button', { name: 'Preview proposal' }).click();
  await review.locator('.scene-direction-preview').waitFor({ timeout: 20_000 });
  const include = review.locator('.scene-direction-preview').getByLabel(/Include this change/);
  await include.nth(1).uncheck();
  const applyButton = page.getByRole('button', { name: /Apply 1 of 2 changes to draft/ });
  check('declining leaves one change to approve', await applyButton.isEnabled());
  await applyButton.click();
  await page.getByText(/1 of 2 reviewed changes applied to your draft/).waitFor({ timeout: 10_000 });
  const draftOnly = planOf(await api(context, `/api/projects/${fixture.projectId}/song-plans`));
  check('the draft apply saves nothing yet', draftOnly.revision === opening.revision, draftOnly.revision);
  await page.getByRole('button', { name: 'Save scene plan' }).click();
  await page.getByText('Scene plan saved.').waitFor({ timeout: 20_000 });
  const saved = planOf(await api(context, `/api/projects/${fixture.projectId}/song-plans`));
  check('saving stores exactly one new revision', saved.revision === opening.revision + 1, saved.revision);
  check('the approved direction is saved', saved.scenes[0].direction === proposal.changes[0].direction, saved.scenes[0].direction);
  check('the declined direction is not saved', saved.scenes[1].direction === opening.scenes[1].direction && saved.scenes[1].direction !== proposal.changes[1].direction, { saved: saved.scenes[1].direction, declined: proposal.changes[1].direction });
  check('takes, timing and captions are unchanged', JSON.stringify(saved.scenes.map(scene => [scene.selectedTakeId, scene.startMs, scene.endMs])) === JSON.stringify(opening.scenes.map(scene => [scene.selectedTakeId, scene.startMs, scene.endMs])) && JSON.stringify(saved.captions) === JSON.stringify(opening.captions));
  const savedHeading = await page.locator('.song-editor-heading p.small').innerText();
  check('the workbench shows the new revision identity', savedHeading.includes(`Revision ${saved.revision}`) && savedHeading.includes(saved.revisionDigest.slice(0, 12)), savedHeading);

  // 3. The same identity through a real scoped MCP client over the local server.
  const token = await mcpToken();
  const client = new Client({ name: 'browser-fixture-agent', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  try {
    const listed = await client.callTool({ name: 'studio_list_song_plans', arguments: { projectId: fixture.projectId } });
    const overMcp = listed.structuredContent?.plans?.find(item => item.id === fixture.plan.id);
    check('the scoped MCP tool reads the same revision and identity', overMcp?.revision === saved.revision && overMcp?.revisionDigest === saved.revisionDigest, { mcp: overMcp?.revisionDigest, ui: saved.revisionDigest });
    check('the MCP read shows the approved direction only', overMcp?.scenes?.[0]?.direction === proposal.changes[0].direction && overMcp?.scenes?.[1]?.direction === opening.scenes[1].direction);
    const diagnosed = await client.callTool({ name: 'studio_diagnose_shot', arguments: { projectId: fixture.projectId, planId: fixture.plan.id, expectedRevision: saved.revision, sceneIds: [saved.scenes[0].id] } });
    check('the MCP diagnosis tool returns the same revision identity', diagnosed.structuredContent?.plan?.revisionDigest === saved.revisionDigest, diagnosed.structuredContent?.plan);
  } finally { await client.close(); }

  // 4. A stale revision shows what happened and what to do.
  if (!(await review.getByLabel('Proposal JSON').isVisible().catch(() => false)))
    await page.locator('summary', { hasText: 'Review a scene proposal' }).last().click();
  await review.getByLabel('Proposal JSON').fill(JSON.stringify({ ...proposal, expectedRevision: opening.revision }));
  await review.getByRole('button', { name: 'Preview proposal' }).click();
  const stale = review.locator('[role="alert"]').last();
  await page.getByText(new RegExp(`The plan changed to revision ${saved.revision}`)).waitFor({ timeout: 20_000 });
  check('a stale revision says what changed and to reload', (await stale.innerText()).includes(`The plan changed to revision ${saved.revision}`) && (await stale.innerText()).includes('Reload it, then preview the edit again'), (await stale.innerText()).slice(0, 200));
  await page.screenshot({ path: `${OUT}/screens/2-stale-revision.png` });

  // 5. Save a two-shot storyboard through the normal assemble controls, then
  // export it on this device and confirm the MP4 actually plays.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.song-plan-list').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Fictional six-scene film/ }).click();
  await page.waitForTimeout(700);
  await page.locator('[data-compose="title"]').fill('Fictional two-shot export');
  const exportClips = [fixture.clips[0].id, fixture.clips[2].id];
  for (const clipId of exportClips) {
    await page.locator(`[data-action="compose-add"][data-id="${clipId}"]`).click();
    await page.waitForTimeout(200);
  }
  const saveStoryboard = page.locator('[data-action="compose-save"]');
  check('the direct two-shot cut is ready to save', await saveStoryboard.isEnabled());
  await saveStoryboard.click();
  const exportCard = page.locator('article.job').filter({ hasText: 'Fictional two-shot export' }).first();
  await exportCard.waitFor({ timeout: 20_000 });
  await exportCard.locator('details.local-render summary').click();
  const renderCard = exportCard.locator('details.local-render');
  await renderCard.getByRole('button', { name: 'Make local MP4' }).click();
  let renderState = '';
  let renderText = '';
  for (let attempt = 0; attempt < 300; attempt++) {
    renderText = await renderCard.innerText().catch(() => '');
    if (renderText.includes('MP4 ready to preview or download.')) { renderState = 'ready'; break; }
    const alert = renderCard.locator('[role="alert"]');
    if ((await alert.count()) && await alert.first().isVisible().catch(() => false)) { renderState = 'error'; break; }
    await page.waitForTimeout(1000);
  }
  check('the local renderer finishes its saved storyboard', renderState === 'ready', renderState === 'ready' ? 'ready' : renderText.slice(-600));
  if (renderState === 'ready') {
    const playback = await page.evaluate(async () => {
      const video = document.querySelector('video[aria-label^="Preview local render"]');
      if (!video) return { error: 'no preview video' };
      if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
      try { await video.play(); } catch (error) { return { error: String(error) }; }
      await new Promise(resolve => setTimeout(resolve, 1200));
      return { duration: video.duration, readyState: video.readyState, currentTime: video.currentTime, paused: video.paused, width: video.videoWidth, height: video.videoHeight, src: video.currentSrc.slice(0, 16) };
    });
    check('the exported revision decodes and plays in the browser', playback.readyState >= 2 && playback.duration > 10 && playback.currentTime > 0.2 && playback.paused === false && playback.width > 0 && playback.height > 0, playback);
    const downloaded = page.waitForEvent('download');
    await renderCard.getByRole('link', { name: 'Download MP4' }).click();
    const file = await downloaded;
    const target = `${OUT}/fictional-two-shot-export.mp4`;
    await file.saveAs(target);
    const bytes = await readFile(target);
    check('the downloaded export is a real MP4 file', bytes.length > 100_000 && bytes.subarray(4, 8).toString('latin1') === 'ftyp', { bytes: bytes.length, head: bytes.subarray(4, 8).toString('latin1') });
    await renderCard.getByRole('button', { name: 'Save to library' }).click();
    await page.getByText('Open saved video').waitFor({ timeout: 20_000 });
    check('the played export is saved to the library', await page.getByText('Open saved video').first().isVisible());
    await page.screenshot({ path: `${OUT}/screens/3-local-export-playing.png` });
  }

  // 6. Clearing a take produces the honest no-take state and price.
  const scenes = page.locator('.song-scenes').first().locator(':scope > li');
  await scenes.nth(2).getByLabel('Selected take').selectOption('');
  await page.getByRole('button', { name: 'Save scene plan' }).click();
  await page.getByText('Scene plan saved.').waitFor({ timeout: 20_000 });
  const afterClear = planOf(await api(context, `/api/projects/${fixture.projectId}/song-plans`));
  const outerReview = page.locator('details').filter({ hasText: 'Review a scene proposal' }).last();
  if (!(await outerReview.getByText('Why is this shot wrong').first().isVisible().catch(() => false)))
    await page.locator('summary', { hasText: 'Review a scene proposal' }).last().click();
  await page.locator('summary', { hasText: 'Why is this shot wrong' }).last().click();
  const doctor2 = page.locator('details').filter({ hasText: 'Why is this shot wrong' }).last();
  await doctor2.getByLabel('Scene 3').check();
  await doctor2.getByRole('button', { name: 'Check these shots' }).click();
  await doctor2.getByText(/Read plan revision/).waitFor({ timeout: 20_000 });
  const noTake = await doctor2.innerText();
  check('the no-take shot explains what is missing', noTake.includes('no saved take') && noTake.includes('has not been generated'), noTake.slice(0, 260));
  check('the no-take shot gives a next step and no invented price', noTake.includes('generate a take deliberately') && noTake.includes('cannot price it until a job is admitted'), noTake.slice(0, 320));
  check('the no-take diagnosis names the current revision', noTake.includes(`Read plan revision ${afterClear.revision}`), afterClear.revision);
  await page.screenshot({ path: `${OUT}/screens/4-no-take.png` });

  // Phone pass over the same panels.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('phone view has no horizontal overflow', !overflow);
  await page.screenshot({ path: `${OUT}/screens/5-phone.png` });
} finally {
  await browser.close().catch(() => {});
  await server.stop().catch(() => {});
  await writeFile(`${OUT}/receipt-shot-doctor.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ checks: receipt.checks.length, failed: receipt.failures.length, fixture: receipt.fixture, out: OUT }));
}
