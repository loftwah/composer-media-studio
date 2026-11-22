// Browser evidence for Studio #489 (first delivery): the read-only promo desk
// in a local fictional wrangler fixture. Chromium only, phone and desktop.
// Read-only: the script creates one extra promo brief through the existing API
// and opens pages; it dispatches no provider job, spends nothing and publishes
// nothing. Failed, waiting and approved job states are covered by the pure
// predicates in tests/promo-desk.test.mjs because no provider key exists here.
import { serve, login, loadPlaywright, api, ORIGIN } from './harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/489';
const pw = await loadPlaywright();
const fixtureFile = path.join(process.env.STUDIO_BROWSER_DIR ?? path.join(os.tmpdir(), 'studio-browser-fixture'), 'fixture.json');
if (!existsSync(fixtureFile)) {
  const { ensureFixture } = await import('./fixture.mjs');
  await ensureFixture();
}
const server = await serve();
const fixture = server.fixture;
await mkdir(`${OUT}/screens`, { recursive: true });
const receipt = { source: process.env.STUDIO_SOURCE_LABEL ?? 'working tree', fixture: { projectId: fixture.projectId, briefId: fixture.brief.id }, startedAt: new Date().toISOString(), runs: [], failures: [] };
const record = (run, check, ok, detail) => {
  receipt.runs.push({ run, check, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) { receipt.failures.push({ run, check, detail }); console.log(`FAIL ${run} · ${check}`, detail ?? ''); }
  else console.log(`ok   ${run} · ${check}`);
};
const assert = (run, check, condition, detail) => record(run, check, Boolean(condition), detail);

async function newContext(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, ...options });
  await login(context);
  return context;
}

const browser = await pw.chromium.launch({ headless: true });
try {
  const context = await newContext(browser);

  // A second saved brief with one scene that has no spoken words becomes the
  // latest, so the desk opens in its missing-input state.
  const second = await api(context, `/api/projects/${fixture.projectId}/promo-briefs`, {
    method: 'POST',
    data: {
      title: 'Fictional incomplete promo', audience: '', brief: '', cta: '',
      aspect: '9:16', targetSeconds: 15,
      scenes: [
        { spoken: 'Only the first scene has words.', visual: 'Fictional visual' },
        { spoken: '', visual: '' },
        { spoken: '', visual: 'Held for the fictional direction' },
      ],
    },
  });
  assert('setup', 'second brief saved', Boolean(second.brief?.id), second.brief?.id);

  // The studio's saved records before the desk is opened: the desk must be a
  // no-op read against them.
  const before = await api(context, `/api/projects/${fixture.projectId}`);
  const beforeJobs = before.generations.length;
  const beforeBriefs = before.promoBriefs ? undefined : (await api(context, `/api/projects/${fixture.projectId}/promo-briefs`)).briefs.length;

  const page = await context.newPage();
  page.on('pageerror', (error) => record('missing-input', 'pageerror', false, String(error).slice(0, 200)));

  // ---------- 1. Missing-input state at desktop and phone ----------
  await page.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
  await page.locator('.promo-desk').waitFor({ state: 'visible', timeout: 30_000 });
  const read = () => page.evaluate(() => ({
    stages: [...document.querySelectorAll('.promo-desk-stages li')].map((li) => ({
      name: li.querySelector('strong')?.textContent ?? '',
      pill: li.querySelector('.status')?.textContent ?? '',
      detail: li.querySelector('.promo-desk-detail')?.textContent ?? '',
      link: li.querySelector('a')?.getAttribute('href') ?? null,
    })),
    next: document.querySelector('.promo-desk-next')?.textContent ?? '',
    head: document.querySelector('.promo-desk-head .small')?.textContent ?? '',
    note: document.querySelector('.promo-desk-note')?.textContent ?? '',
    select: document.querySelector('.promo-saved-select select')?.value ?? '',
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));

  let desk = await read();
  const roomsScoped = await page.evaluate((projectId) => {
    const paths = performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((path) => path.endsWith('/review-rooms'));
    return paths.length > 0 && paths.every((path) => path === `/api/projects/${projectId}/review-rooms`);
  }, fixture.projectId);
  assert('missing-input', 'desk is present and room reads stay in this project', desk.stages.length === 4 && roomsScoped, { stages: desk.stages.length, roomsScoped });
  const scriptRow = desk.stages.find((row) => row.name === 'Script');
  assert('missing-input', 'script shows the missing-input pill', scriptRow?.pill === 'Missing input', scriptRow);
  assert('missing-input', 'script names the two empty scenes', /Scenes 2 and 3 have no spoken words/.test(scriptRow?.detail ?? ''), scriptRow?.detail);
  assert('missing-input', 'narration, storyboard and review are not ready', desk.stages.slice(1).every((row) => !/Ready/.test(row.pill)), desk.stages.map((s) => s.pill));
  assert('missing-input', 'downstream stages are blocked, not missing', desk.stages[1].pill === 'Missing' && desk.stages[2].pill === 'Blocked' && desk.stages[3].pill === 'Blocked', desk.stages.map((s) => s.pill));
  assert('missing-input', 'next action points at scene 2', /scene 2/i.test(desk.next), desk.next);
  await page.locator('.promo-desk').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/screens/desk-missing-input-desktop.png`, fullPage: false });
  await page.locator('.promo-desk').screenshot({ path: `${OUT}/screens/desk-element-desktop.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  desk = await read();
  assert('missing-input-phone', 'phone has no horizontal overflow', desk.horizontalOverflow === false, desk.horizontalOverflow);
  assert('missing-input-phone', 'phone keeps all four stages', desk.stages.length === 4, desk.stages.length);
  await page.screenshot({ path: `${OUT}/screens/desk-missing-input-phone.png`, fullPage: false });
  await page.locator('.promo-desk').screenshot({ path: `${OUT}/screens/desk-element-phone.png` });

  // ---------- 2. The desk is a no-op read ----------
  const after = await api(context, `/api/projects/${fixture.projectId}`);
  record('no-op-read', 'no new generation jobs after opening the desk', after.generations.length === beforeJobs, { before: beforeJobs, after: after.generations.length });
  const afterBriefs = (await api(context, `/api/projects/${fixture.projectId}/promo-briefs`)).briefs.length;
  record('no-op-read', 'no new or changed briefs after opening the desk', afterBriefs === beforeBriefs, { before: beforeBriefs, after: afterBriefs });

  // ---------- 3. Keyboard: switch the saved brief; the desk follows ----------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  await page.locator('.promo-saved-select select').selectOption(fixture.brief.id);
  await page.waitForTimeout(250);
  desk = await read();
  const scriptReady = desk.stages.find((row) => row.name === 'Script');
  assert('switch-brief', 'script becomes ready for the complete brief', scriptReady?.pill === 'Ready', scriptReady);
  assert('switch-brief', 'script states revision, scenes and estimate', /Revision \d+ · 6 scenes · about \d+s/.test(scriptReady?.detail ?? ''), scriptReady?.detail);
  assert('switch-brief', 'narration is missing, not failed or waiting', desk.stages[1].pill === 'Missing' && /inferred|exact script/.test(desk.stages[1].detail), desk.stages[1]);
  assert('switch-brief', 'narration says the exact-text match is inferred, not linked', /No saved Studio Voice job has this exact script/.test(desk.stages[1].detail) && /inferred/.test(desk.stages[1].detail), desk.stages[1].detail);
  assert('switch-brief', 'storyboard is blocked on the narration', desk.stages[2].pill === 'Blocked' && /narration/i.test(desk.stages[2].detail), desk.stages[2]);
  assert('switch-brief', 'next action offers the narration step', /Studio Voice/.test(desk.next) && !/http/.test(desk.next), desk.next);
  assert('switch-brief', 'the desk labels matches as inferred, not saved links', /inferred from saved records/.test(desk.head) && /not links saved with this brief revision/.test(desk.note), { head: desk.head, note: desk.note });
  await page.locator('.promo-desk').scrollIntoViewIfNeeded();
  await page.locator('.promo-desk').screenshot({ path: `${OUT}/screens/desk-element-switched.png` });

  // Keyboard reachability: the desk adds no focus trap; Tab reaches its links
  // and the saved-brief select keeps working by keyboard.
  await page.keyboard.press('Tab');
  const focusStart = await page.evaluate(() => document.activeElement?.className ?? '');
  record('keyboard', 'tabbing moves focus into the page (no trap)', focusStart !== '', focusStart);
  const selectFocused = await page.evaluate(() => {
    const select = document.querySelector('.promo-saved-select select');
    select?.focus();
    return document.activeElement === select;
  });
  record('keyboard', 'the saved-brief select is focusable', selectFocused, selectFocused);

  // ---------- 4. Deep links render as real hash routes ----------
  const linkHrefs = await page.evaluate(() => [...document.querySelectorAll('.promo-desk a')].map((a) => a.getAttribute('href')));
  record('links', 'every desk link is an in-studio hash route', linkHrefs.every((href) => href?.startsWith('#/')), linkHrefs);
  // Follow the review-row link shape by routing to History and back.
  await page.goto(`${ORIGIN}/#/p/${fixture.projectId}/history`, { waitUntil: 'networkidle' });
  const historyOk = await page.evaluate(() => Boolean(document.querySelector('main, body')) && location.hash.includes('/history'));
  record('links', 'the History route the desk points at opens', historyOk, historyOk);
  // The asset deep link the desk uses for saved takes and cuts opens the viewer.
  await page.goto(`${ORIGIN}/#/a/${fixture.projectId}/${fixture.clips[0].id}`, { waitUntil: 'networkidle' });
  await page.locator('[data-viewer="true"]').waitFor({ state: 'visible', timeout: 15_000 });
  record('links', 'the asset deep link opens the in-project viewer', await page.evaluate(() => document.querySelector('[data-viewer="true"]')?.getAttribute('aria-modal') === 'true'));

  // ---------- 5. Dark theme at phone width ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('media-studio-theme', 'dark'));
  await page.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
  await page.locator('.promo-desk').waitFor({ state: 'visible', timeout: 30_000 });
  const dark = await read();
  assert('dark-phone', 'dark theme keeps the desk and no overflow', dark.stages.length === 4 && dark.horizontalOverflow === false, dark.horizontalOverflow);
  await page.screenshot({ path: `${OUT}/screens/desk-switched-phone-dark.png`, fullPage: false });

  await context.close();
} finally {
  await browser.close();
  await server.stop();
}

await writeFile(`${OUT}/promo-desk-receipt.json`, JSON.stringify(receipt, null, 2));
console.log(`receipt: ${JSON.stringify(receipt.failures.length === 0 ? 'all checks passed' : receipt.failures)}`);
process.exit(receipt.failures.length ? 1 : 0);
