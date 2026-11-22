// MIT. Real-browser evidence for one Studio-native local media operation:
// saved storyboard -> local MP4 render -> private render receipt -> save to
// library -> reopened owned asset, plus recovery behaviour: a save whose
// response is dropped after the server committed still offers a retry, and
// that retry re-sends the exact same receipt so it returns the same asset
// (200) with exactly one library copy. Cancelling mid-render is honest.
// Local wrangler only: no deploy, no provider, no paid generation, no owner data.

import { ensureFixture } from './fixture.mjs';
import { serve, login, loadPlaywright, ORIGIN, api } from './harness.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/local-render-recovery';
await mkdir(`${OUT}/screens`, { recursive: true });
const fixture = await ensureFixture();
const pw = await loadPlaywright();
const server = await serve();
const browser = await pw.chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await login(context);
const page = await context.newPage();
page.on('pageerror', error => console.log('PAGEERROR', error.message.slice(0, 300)));
const receipt = { fixture: { projectId: fixture.projectId, planId: fixture.plan.id, revision: fixture.plan.revision }, checks: [], failures: [], statuses: [] };
const check = (name, ok, detail) => {
  receipt.checks.push({ name, ok, detail });
  if (!ok) { receipt.failures.push({ name, detail }); console.log('FAIL', name, JSON.stringify(detail)?.slice(0, 500) ?? ''); }
  else console.log('ok  ', name);
};

// Record the local render receipt id that the render created (passive read).
let seenReceiptId = null;
page.on('response', async response => {
  if (!/\/local-render-receipts$/.test(response.url()) || response.status() !== 201) return;
  seenReceiptId = (await response.json().catch(() => ({})))?.receipt?.id ?? seenReceiptId;
});

try {
  // 1. Compose and save a real two-shot storyboard through the normal controls.
  await page.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
  await page.locator('.song-plan-list').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /Fictional six-scene film/ }).click();
  await page.waitForTimeout(700);
  const runTag = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19);
  const storyboardTitle = `Fictional two-shot export ${runTag}`;
  await page.locator('[data-compose="title"]').fill(storyboardTitle);
  for (const clipId of [fixture.clips[0].id, fixture.clips[2].id]) {
    await page.locator(`[data-action="compose-add"][data-id="${clipId}"]`).click();
    await page.waitForTimeout(200);
  }
  const saveStoryboard = page.locator('[data-action="compose-save"]');
  check('the two-shot storyboard is ready to save', await saveStoryboard.isEnabled());
  await saveStoryboard.click();
  const exportCard = page.locator('article.job').filter({ hasText: storyboardTitle }).first();
  await exportCard.waitFor({ timeout: 20_000 });
  const projectState = await api(context, `/api/projects/${fixture.projectId}`);
  const savedAt = projectState.compositions.find(c => c.title === storyboardTitle);
  check('the saved storyboard exists server-side with its own id and revision', Boolean(savedAt?.id && savedAt?.updatedAt), savedAt && { id: savedAt.id, updatedAt: savedAt.updatedAt, shots: savedAt.shots.length });
  await exportCard.locator('details.local-render summary').click();
  const renderCard = exportCard.locator('details.local-render');
  const planLabel = await renderCard.locator('p.small').first().innerText();
  check('the local render names the exact saved version it will use', /Saved storyboard:/.test(planLabel) && /The MP4 always reads this saved version from the server/.test(planLabel), planLabel.slice(0, 200));

  // 2. Run the render and record the observed status messages.
  await renderCard.getByRole('button', { name: 'Make local MP4' }).click();
  let renderState = '', renderText = '';
  for (let attempt = 0; attempt < 300; attempt++) {
    renderText = await renderCard.innerText().catch(() => '');
    const status = renderText.match(/([A-Z][^\n]{8,120}…|MP4 ready to preview or download\.)/);
    if (status && receipt.statuses.at(-1) !== status[1]) receipt.statuses.push(status[1]);
    if (renderText.includes('MP4 ready to preview or download.')) { renderState = 'ready'; break; }
    const alert = renderCard.locator('[role="alert"]');
    if ((await alert.count()) && await alert.first().isVisible().catch(() => false)) { renderState = 'error'; break; }
    await page.waitForTimeout(500);
  }
  check('the local render finishes with a ready status', renderState === 'ready', renderState === 'ready' ? 'ready' : renderText.slice(-500));

  // 3. The result decodes and plays; the download is a real MP4.
  let bytes = null;
  if (renderState === 'ready') {
    const playback = await page.evaluate(async () => {
      const video = document.querySelector('video[aria-label^="Preview local render"]');
      if (!video) return { error: 'no preview video' };
      if (video.readyState < 1) await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
      try { await video.play(); } catch (error) { return { error: String(error) }; }
      await new Promise(resolve => setTimeout(resolve, 1200));
      return { duration: video.duration, readyState: video.readyState, currentTime: video.currentTime, paused: video.paused, width: video.videoWidth, height: video.videoHeight };
    });
    check('the rendered MP4 decodes and plays in the browser', playback.readyState >= 2 && playback.duration > 10 && playback.currentTime > 0.2 && !playback.paused && playback.width > 0, playback);
    const downloaded = page.waitForEvent('download');
    await renderCard.getByRole('link', { name: 'Download MP4' }).click();
    const file = await downloaded;
    await file.saveAs(`${OUT}/fictional-two-shot-export.mp4`);
    bytes = await readFile(`${OUT}/fictional-two-shot-export.mp4`);
    check('the download is a real MP4', bytes.length > 100_000 && bytes.subarray(4, 8).toString('latin1') === 'ftyp', { bytes: bytes.length, head: bytes.subarray(4, 8).toString('latin1') });
  }

  // 4. Interruption probe: the Save reaches the server and commits, but the
  // response is dropped before the page can read it. This is the state a real
  // retry has to survive: the asset already exists.
  if (renderState === 'ready') {
    let droppedCommitted = false;
    let committedAssetId = '';
    await page.route('**/api/projects/*/assets', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const committed = await route.fetch();
      committedAssetId = (await committed.json().catch(() => ({})))?.asset?.id ?? '';
      droppedCommitted = committed.status() === 201;
      await route.abort('connectionreset');
    });
    await renderCard.getByRole('button', { name: 'Save to library' }).click();
    const guidanceShown = await page.getByText('Check the library before trying again').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);
    const cardAfterDrop = await renderCard.innerText().catch(() => '');
    check('a save that committed server-side but lost its response is stated honestly',
      guidanceShown && droppedCommitted && /^asset_[a-z0-9_]+$/.test(committedAssetId) &&
        cardAfterDrop.includes('Check the library before trying again') && cardAfterDrop.includes('your download remains available'),
      { guidanceShown, droppedCommitted, committedAssetId, card: cardAfterDrop.match(/[^\n]*could not be confirmed[^\n]*/)?.[0] ?? cardAfterDrop.slice(-300) });
    await page.unroute('**/api/projects/*/assets');

    // 5. Recovery: retry the save with the same bytes and the same receipt id.
    // The server already committed this receipt's output asset, so the retry
    // reconciles to that asset with 200 instead of creating a second one.
    const retryButton = renderCard.getByRole('button', { name: /Retry save to library/ });
    const retryEnabled = (await retryButton.isVisible().catch(() => false)) && (await retryButton.isEnabled().catch(() => false));
    check('a safe retry of the interrupted save is offered', retryEnabled, { retryEnabled, seenReceiptId });
    if (retryEnabled) {
      // The retry is reachable and activatable from the keyboard.
      await retryButton.focus();
      check('the retry control takes keyboard focus', (await page.evaluate(() => document.activeElement?.textContent))?.includes('Retry save to library'), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
      const retryResponse = page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/projects\/[^/]+\/assets$/.test(response.url()), { timeout: 30_000 });
      await page.keyboard.press('Enter');
      const retried = await retryResponse;
      await page.getByText('Open saved video').waitFor({ timeout: 30_000 });
      check('the retried save recovers to a confirmed library asset', true, 'Open saved video');
      const retriedBody = await retried.json().catch(() => ({}));
      const retryBodyText = retried.request().postDataBuffer()?.toString('latin1') ?? '';
      check('the retry re-sends the same receipt and the server returns 200',
        retried.status() === 200 && retriedBody.asset?.hasLocalRenderReceipt === true &&
          retriedBody.asset?.id === committedAssetId && (!retryBodyText || retryBodyText.includes(seenReceiptId ?? '')),
        { status: retried.status(), seenReceiptId, receiptBound: retriedBody.asset?.hasLocalRenderReceipt, bodyVisible: Boolean(retryBodyText) });
      check('the retry resolves to the asset the dropped response had committed', retriedBody.asset?.id === committedAssetId, { retried: retriedBody.asset?.id, committed: committedAssetId });
    }
  }

  // 6. Provenance: the saved asset, its bytes and its private receipt.
  const savedHref = await page.getByText('Open saved video').first().getAttribute('href').catch(() => null);
  const assetId = savedHref?.match(/\/a\/[^/]+\/(asset_[a-z0-9_]+)/)?.[1] ?? '';
  check('the render is saved to the library', /^asset_[a-z0-9_]+$/.test(assetId), { assetId, seenReceiptId });
  if (/^asset_/.test(assetId) && bytes) {
    check('the save carried a private local render receipt id', /^lrr_[a-f0-9]{32}$/.test(seenReceiptId ?? ''), seenReceiptId);
    const view = await api(context, `/api/assets/${assetId}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    check('the saved asset matches the downloaded bytes by SHA-256', view.asset?.sha256 === hash, { asset: view.asset?.sha256?.slice(0, 12), file: hash.slice(0, 12) });
    const ev = await api(context, `/api/assets/${assetId}/local-render-receipt`);
    const snap = ev.receipt ?? {};
    check('the private receipt is server-verified and names the storyboard, shots and digests',
      snap.evidence?.snapshot === 'server_verified' && snap.storyboard?.id === savedAt?.id &&
      Array.isArray(snap.shots) && snap.shots.length === 2 && snap.shots.every(s => /^[a-f0-9]{64}$/.test(s.sha256 ?? '')),
      { storyboard: snap.storyboard?.id, shots: snap.shots?.length, evidence: snap.evidence });
    const reopened = await api(context, `/api/projects/${fixture.projectId}`);
    const sameTitle = (reopened.assets ?? []).filter(a => a.title === `Local render — ${storyboardTitle}`);
    check('exactly one library asset exists for this render (no duplicate)', sameTitle.length === 1, sameTitle.length);
  }

  // 7. Status probe: cancelling mid-render is an honest terminal state and a
  // fresh render still runs afterwards.
  if (renderState === 'ready') {
    await renderCard.getByRole('button', { name: 'Make local MP4' }).click();
    let cancelled = false;
    for (let attempt = 0; attempt < 40 && !cancelled; attempt++) {
      const cancel = renderCard.getByRole('button', { name: 'Cancel' });
      if (await cancel.isVisible().catch(() => false)) { await cancel.click(); cancelled = true; break; }
      if ((await renderCard.innerText().catch(() => '')).includes('MP4 ready to preview or download.')) break;
      await page.waitForTimeout(200);
    }
    if (cancelled) {
      await page.getByText('Local render cancelled.').waitFor({ timeout: 20_000 });
      check('cancelling a local render is stated honestly', true, 'Local render cancelled.');
      await renderCard.getByRole('button', { name: 'Make local MP4' }).click();
      let rerendered = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        if ((await renderCard.innerText().catch(() => '')).includes('MP4 ready to preview or download.')) { rerendered = true; break; }
        await page.waitForTimeout(500);
      }
      check('a fresh render runs after a cancellation', rerendered, rerendered ? 'ready again' : 'stuck');
    } else {
      check('cancel is offered while a render runs', false, 'render finished before the cancel window');
    }
  }
  await exportCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/screens/local-render-recovery.png` });

  // 8. Phone-width pass over the same card.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('phone view has no horizontal overflow', !overflow);
  await exportCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/screens/local-render-recovery-phone.png` });
} catch (error) {
  receipt.failures.push({ name: 'harness', detail: String(error).slice(0, 500) });
  console.log('HARNESS ERROR', String(error).slice(0, 500));
} finally {
  await browser.close().catch(() => {});
  await server.stop().catch(() => {});
  await writeFile(`${OUT}/receipt-local-render-recovery.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ checks: receipt.checks.length, failed: receipt.failures.length, fixture: receipt.fixture, out: OUT }));
}
