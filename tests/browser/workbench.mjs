// Browser evidence for Studio #148: the promo workbench in a local fictional
// wrangler fixture. Chromium is the full matrix; Firefox/WebKit re-run the core.
import { serve, login, loadPlaywright, api, ORIGIN } from './harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/148';
const ONLY = process.env.ONLY ?? '';
const pw = await loadPlaywright();
const server = await serve();
const fixture = server.fixture;
await mkdir(`${OUT}/screens`, { recursive: true });
const receipt = { source: process.env.STUDIO_SOURCE_LABEL ?? 'working tree', fixture: { projectId: fixture.projectId, briefId: fixture.brief.id, planId: fixture.plan.id }, startedAt: new Date().toISOString(), runs: [], failures: [] };
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
async function openAssemble(page) {
  await page.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
  await page.locator('.promo-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(300);
}
const layout = page => page.evaluate(() => {
  const root = document.documentElement;
  const strip = document.querySelector('.promo-workbench');
  const overflowers = [];
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed') continue;
    if (!['INPUT','TEXTAREA','SELECT','OPTION'].includes(el.tagName) && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !['auto', 'scroll'].includes(style.overflowX)) {
      const isMedia = el.closest('video, audio, svg, canvas, .sparkline');
      if (!isMedia) overflowers.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
  }
  const nested = [];
  for (const el of document.querySelectorAll('.promo-workbench, .promo-rail, .promo-stage, .promo-stage fieldset, .promo-scene-fields, .promo-script')) {
    const style = getComputedStyle(el);
    if (el.scrollHeight > el.clientHeight + 2 && ['auto', 'scroll'].includes(style.overflowY)) nested.push({ cls: String(el.className).slice(0, 40), overflowY: style.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
  }
  const rect = el => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  const controlsOut = [...document.querySelectorAll('.promo-workbench input, .promo-workbench select, .promo-workbench textarea')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).map(el => ({ tag: el.tagName, type: el.type, left: Math.round(el.getBoundingClientRect().left), right: Math.round(el.getBoundingClientRect().right) }));
  return {
    controlsOut,
    viewport: { width: innerWidth, height: innerHeight },
    document: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollHeight: root.scrollHeight },
    horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
    overflowers: overflowers.slice(0, 8),
    nested,
    workbench: strip ? rect(strip) : null,
    save: document.querySelector('.promo-save-bar button[type=submit]') ? rect(document.querySelector('.promo-save-bar button[type=submit]')) : null,
    status: document.querySelector('.promo-save-status')?.textContent ?? null,
    sceneCount: document.querySelectorAll('.promo-scene-button').length,
    active: document.querySelector('.promo-scene-button[aria-current=step]')?.getAttribute('data-scene-index') ?? null,
    fixedBars: [...document.querySelectorAll('body *')].filter(el => getComputedStyle(el).position === 'fixed' && el.checkVisibility?.({ checkVisibilityCSS: true })).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 40) })).slice(0, 6),
  };
});

const browser = await pw.chromium.launch({ headless: true });
try {
  // ---------- 1. Six long scenes across the viewport matrix ----------
  const context = await newContext(browser);
  const page = await context.newPage();
  page.on('pageerror', e => record('six-scenes', 'pageerror', false, e.message.slice(0, 200)));
  await openAssemble(page);
  const matrix = [
    [1728, 1117, '1728x1117'], [1512, 982, '1512x982'], [1440, 900, '1440x900'], [1280, 800, '1280x800'],
    [1024, 768, '1024x768'], [768, 1024, '768x1024'], [390, 844, '390x844'], [320, 640, '320x640'],
  ];
  for (const [width, height, label] of matrix) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const m = await layout(page);
    assert('six-scenes', `${label} six scene buttons`, m.sceneCount === 6, m.sceneCount);
    assert('six-scenes', `${label} no horizontal document overflow`, !m.horizontalOverflow, m.document);
    assert('six-scenes', `${label} no workbench scroll prison`, m.nested.length === 0, m.nested);
    assert('six-scenes', `${label} no inline overflowers`, m.overflowers.length === 0, m.overflowers);
    assert('six-scenes', `${label} form controls stay inside the viewport`, m.controlsOut.length === 0, m.controlsOut);
    await page.locator('[data-scene-index="5"]').click();
    await page.waitForTimeout(120);
    const active = await page.locator('.promo-scene-panel').innerText();
    const field = await page.locator('.promo-scene-fields textarea').first().inputValue();
    assert('six-scenes', `${label} scene 6 opens in the active editor`, /scene 6 of 6/i.test(active) && field.includes('Scene 6.'), { active: active.slice(0, 60) });
    const expected = field.trim() ? field.trim().split(/\s+/u).length : 0;
    const shown = await page.locator('.promo-scene-fields .small').first().innerText();
    assert('six-scenes', `${label} active word count is honest`, shown.startsWith(`${expected} words`), { expected, shown });
    if (label === '1440x900' || label === '390x844') await page.screenshot({ path: `${OUT}/screens/six-scenes-${label}.png` });
  }
  // Dark theme + long text at the two extremes.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(200);
  assert('six-scenes', '1440 dark no horizontal overflow', !(await layout(page)).horizontalOverflow);
  await page.screenshot({ path: `${OUT}/screens/six-scenes-1440x900-dark.png` });
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });
  await context.close();

  // ---------- 2. 200%/400% reflow (WCAG 1.4.10 equivalent viewports) ----------
  {
    const context2 = await newContext(browser, { viewport: { width: 640, height: 400 } });
    const p = await context2.newPage();
    await openAssemble(p);
    for (const [width, height, label] of [[640, 400, '200%-of-1280x800'], [320, 256, '400%-of-1280x1024']]) {
      await p.setViewportSize({ width, height });
      await p.waitForTimeout(200);
      const m = await layout(p);
      assert('reflow', `${label} no horizontal document overflow`, !m.horizontalOverflow, m.document);
      assert('reflow', `${label} no inline overflowers`, m.overflowers.length === 0, m.overflowers);
      assert('reflow', `${label} form controls stay inside the viewport`, m.controlsOut.length === 0, m.controlsOut);
      assert('reflow', `${label} save action remains in the document`, Boolean(m.save));
      await p.screenshot({ path: `${OUT}/screens/reflow-${label}.png`, fullPage: false });
    }
    await context2.close();
  }

  // ---------- 3. Empty brief, add/remove scene, focus restoration ----------
  {
    const context3 = await newContext(browser, { viewport: { width: 1440, height: 900 } });
    const p = await context3.newPage();
    p.on('dialog', d => d.accept());
    await openAssemble(p);
    await p.locator('.promo-rail select').selectOption('');
    await p.waitForTimeout(200);
    let m = await layout(p);
    assert('scenes', 'new empty brief starts with two scenes', m.sceneCount === 2, m.sceneCount);
    await p.getByRole('button', { name: 'Add scene' }).click();
    await p.waitForTimeout(200);
    m = await layout(p);
    const focusAdd = await p.evaluate(() => document.activeElement?.getAttribute('data-scene-index'));
    assert('scenes', 'add appends a third scene', m.sceneCount === 3, m.sceneCount);
    assert('scenes', 'add selects and focuses the new scene', m.active === '2' && focusAdd === '2', { active: m.active, focusAdd });
    await p.getByRole('button', { name: 'Remove scene' }).click();
    await p.waitForTimeout(200);
    m = await layout(p);
    const focusRemove = await p.evaluate(() => document.activeElement?.getAttribute('data-scene-index'));
    assert('scenes', 'remove returns to two scenes', m.sceneCount === 2, m.sceneCount);
    assert('scenes', 'remove focuses the scene that takes its place', focusRemove === '1', { focusRemove, active: m.active });
    await p.getByRole('button', { name: 'Add scene' }).focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(150);
    assert('scenes', 'keyboard add works', (await layout(p)).sceneCount === 3);
    await context3.close();
  }

  // ---------- 4-6. Draft retention, save/reopen, real 409 recovery ----------
  {
    const contextA = await newContext(browser);
    const a = await contextA.newPage();
    a.on('dialog', d => d.accept());
    await openAssemble(a);
    await a.locator('.promo-rail select').selectOption(fixture.brief.id);
    await a.waitForTimeout(200);
    const title = a.locator('.promo-brief-panel input').first();
    const startedRevision = Number((await a.locator('.promo-save-status').innerText()).match(/revision (\d+)/)?.[1] ?? 0);
    await title.fill(`Fictional workbench draft ${Date.now()}`);
    const draftTitle = await title.inputValue();
    // Tab switch keeps the unsaved draft.
    await a.goto(`${ORIGIN}/#/p/${fixture.projectId}/library`, { waitUntil: 'networkidle' });
    await a.waitForTimeout(400);
    await a.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
    await a.locator('.promo-workbench').waitFor();
    await a.waitForTimeout(300);
    assert('journey', 'unsaved draft survives a tab switch', (await a.locator('.promo-brief-panel input').first().inputValue()) === draftTitle);
    assert('journey', 'tab switch status stays unsaved', (await a.locator('.promo-save-status').innerText()) === 'Unsaved changes', await a.locator('.promo-save-status').innerText());
    // Save and reopen.
    await a.getByRole('button', { name: 'Save changes' }).click();
    await a.locator('.promo-save-status', { hasText: `Saved · revision ${startedRevision + 1}` }).waitFor({ timeout: 10_000 });
    const savedRevision = startedRevision + 1;
    await a.reload({ waitUntil: 'networkidle' });
    await a.locator('.promo-workbench').waitFor();
    await a.waitForTimeout(400);
    assert('journey', 'reload reopens the latest saved revision', (await a.locator('.promo-brief-panel input').first().inputValue()) === draftTitle);
    assert('journey', 'reload reports the saved revision', (await a.locator('.promo-save-status').innerText()) === `Saved · revision ${savedRevision}`, await a.locator('.promo-save-status').innerText());

    // Conflict: a second page saves the same brief after A loaded it.
    const b = await contextA.newPage();
    b.on('dialog', d => d.accept());
    await openAssemble(b);
    await b.locator('.promo-rail select').selectOption(fixture.brief.id);
    await b.waitForTimeout(250);
    const bTitle = b.locator('.promo-brief-panel input').first();
    await bTitle.fill(`${draftTitle} — elsewhere`);
    await b.getByRole('button', { name: 'Save changes' }).click();
    await b.locator('.promo-save-status', { hasText: `Saved · revision ${savedRevision + 1}` }).waitFor({ timeout: 10_000 });

    const aTitle = a.locator('.promo-brief-panel input').first();
    await aTitle.fill(`${draftTitle} — my draft`);
    const myDraft = await aTitle.inputValue();
    await a.getByRole('button', { name: 'Save changes' }).click();
    await a.locator('.promo-conflict').waitFor({ timeout: 10_000 });
    const conflictText = await a.locator('.promo-conflict').innerText();
    assert('journey', 'a stale save returns a real 409 recovery', conflictText.includes(`Review latest saved version ${savedRevision + 1}`), conflictText.slice(0, 120));
    assert('journey', '409 keeps the unsaved draft', (await aTitle.inputValue()) === myDraft);
    const focusOnConflict = await a.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.textContent ?? '').slice(0, 40));
    assert('journey', '409 moves focus into the recovery review', focusOnConflict.startsWith('SUMMARY:'), focusOnConflict);
    await a.screenshot({ path: `${OUT}/screens/conflict-1440x900.png` });
    await a.getByRole('button', { name: `Keep my draft on v${savedRevision + 1}` }).click();
    await a.waitForTimeout(250);
    const focusAfterKeep = await a.evaluate(() => document.activeElement?.textContent ?? '');
    assert('journey', 'Keep returns focus to Save', focusAfterKeep.includes('Save changes'), focusAfterKeep);
    await a.getByRole('button', { name: 'Save changes' }).click();
    await a.locator('.promo-save-status', { hasText: `Saved · revision ${savedRevision + 2}` }).waitFor({ timeout: 10_000 });
    await a.reload({ waitUntil: 'networkidle' });
    await a.locator('.promo-workbench').waitFor();
    await a.waitForTimeout(400);
    assert('journey', 'conflict-resolved save persists on reload', (await a.locator('.promo-brief-panel input').first().inputValue()) === myDraft);
    const server = await api(contextA, `/api/projects/${fixture.projectId}/promo-briefs`);
    const latest = server.briefs.find(x => x.id === fixture.brief.id);
    assert('journey', 'server revision advanced exactly twice', latest.revision === savedRevision + 2, latest.revision);
    await contextA.close();
  }

  // ---------- 7. Emulated mobile software keyboard ----------
  {
    const context4 = await newContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const k = await context4.newPage();
    k.on('dialog', d => d.accept());
    await openAssemble(k);
    await k.locator('[data-scene-index="5"]').click();
    const field = k.locator('.promo-scene-fields textarea').first();
    await field.focus();
    assert('mobile-keyboard', 'real textarea focus on a 390x844 viewport', await field.evaluate(el => document.activeElement === el));
    // A software keyboard contracts the visual viewport. Playwright cannot open a
    // real OS keyboard, so contract the viewport to the size Chrome reports after
    // a keyboard opens on this device class (emulated, not physical evidence).
    await k.setViewportSize({ width: 390, height: 430 });
    // Chrome/Safari reveal the focused field when a keyboard contracts the viewport.
    await field.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await k.waitForTimeout(350);
    const after = await k.evaluate(() => {
      const el = document.activeElement;
      const rect = el?.getBoundingClientRect();
      const vv = window.visualViewport;
      return { tag: el?.tagName, rect: rect ? { top: rect.top, bottom: rect.bottom } : null, innerHeight, visualHeight: vv?.height ?? null, scrollY };
    });
    assert('mobile-keyboard', 'focused field stays in the contracted viewport', after.tag === 'TEXTAREA' && after.rect.top >= 0 && after.rect.bottom <= after.innerHeight + 1, after);
    const save = k.locator('.promo-save-bar button[type=submit]');
    await save.scrollIntoViewIfNeeded();
    await k.waitForTimeout(200);
    const box = await save.boundingBox();
    const hit = await k.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert('mobile-keyboard', 'Save stays reachable and hit-testable after contraction', Boolean(hit && hit.includes('Save')), hit);
    assert('mobile-keyboard', 'no fixed overlay covers the editing surface', (await layout(k)).fixedBars.length === 0, (await layout(k)).fixedBars);
    await k.screenshot({ path: `${OUT}/screens/mobile-keyboard-emulated-390x430.png` });
    await context4.close();
  }

  // ---------- 8. Reduced motion ----------
  {
    const context5 = await newContext(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const r = await context5.newPage();
    await openAssemble(r);
    const durations = await r.evaluate(() => {
      const names = ['.promo-scene-button', '.promo-save-status', '.promo-workbench button', '.song-plans summary', '.promo-saved-select select'];
      return names.map(selector => {
        const el = document.querySelector(selector);
        if (!el) return { selector, missing: true };
        const style = getComputedStyle(el);
        return { selector, transition: style.transitionDuration, animation: style.animationDuration };
      });
    });
    const moving = durations.filter(d => !d.missing && (parseFloat(d.transition) > 0.02 || parseFloat(d.animation) > 0.02));
    assert('reduced-motion', 'workbench transitions and animations are suppressed', moving.length === 0, moving);
    await r.locator('.promo-brief-panel input').first().fill('Reduced motion state check');
    assert('reduced-motion', 'state is still communicated in text, not motion', (await r.locator('.promo-save-status').innerText()) === 'Unsaved changes');
    await r.screenshot({ path: `${OUT}/screens/reduced-motion-1440x900.png` });
    await context5.close();
  }

  // ---------- 9. Sibling Create/SongPlans/Footage/Library/History/Publish/Settings audit ----------
  {
    const context6 = await newContext(browser);
    const s = await context6.newPage();
    const tabs = [
      ['create', 'Create'], ['assemble', 'Assemble'], ['library', 'Library'], ['history', 'History'], ['publish', 'Publish'], ['settings', 'Settings'],
    ];
    for (const [tab, name] of tabs) {
      for (const [width, height, label] of [[1440, 900, '1440x900'], [390, 844, '390x844']]) {
        await s.setViewportSize({ width, height });
        await s.goto(`${ORIGIN}/#/p/${fixture.projectId}/${tab}`, { waitUntil: 'networkidle' });
        await s.waitForTimeout(900);
        const m = await s.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, width: innerWidth }));
        assert('siblings', `${name} ${label} no horizontal overflow`, m.scrollWidth <= m.clientWidth + 1, m);
        if (tab === 'assemble') {
          const song = await s.locator('#song-plans-title').count();
          assert('siblings', `${name} ${label} song planner present`, song === 1, song);
        }
      }
    }
    await s.setViewportSize({ width: 1440, height: 900 });
    await s.goto(`${ORIGIN}/#/p/${fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
    await s.waitForTimeout(800);
    await s.locator('#song-plans-title').scrollIntoViewIfNeeded();
    await s.screenshot({ path: `${OUT}/screens/song-plans-1440x900.png`, fullPage: false });
    await context6.close();
  }

  // ---------- 10. Cross-engine core (Firefox, WebKit) ----------
  for (const engine of ['firefox', 'webkit']) {
    let engineBrowser;
    try {
      engineBrowser = await pw[engine].launch({ headless: true });
      const context7 = await newContext(engineBrowser);
      const e = await context7.newPage();
      const errors = [];
      e.on('pageerror', error => errors.push(error.message.slice(0, 160)));
      await openAssemble(e);
      const m = await layout(e);
      assert(engine, 'six scenes render', m.sceneCount === 6, m.sceneCount);
      assert(engine, 'no horizontal document overflow at 1440', !m.horizontalOverflow, m.document);
      await e.locator('[data-scene-index="5"]').click();
      assert(engine, 'scene 6 opens', /scene 6 of 6/i.test(await e.locator('.promo-scene-panel').innerText()));
      await e.locator('.promo-brief-panel input').first().fill(`Fictional ${engine} draft ${Date.now()}`);
      const value = await e.locator('.promo-brief-panel input').first().inputValue();
      await e.getByRole('button', { name: 'Save changes' }).click();
      await e.locator('.promo-save-status', { hasText: 'Saved · revision' }).waitFor({ timeout: 15_000 });
      await e.reload({ waitUntil: 'networkidle' });
      await e.locator('.promo-workbench').waitFor();
      await e.waitForTimeout(400);
      assert(engine, 'saved draft reopens after reload', (await e.locator('.promo-brief-panel input').first().inputValue()) === value);
      await e.setViewportSize({ width: 390, height: 844 });
      await e.waitForTimeout(300);
      assert(engine, '390 phone reflow has no horizontal overflow', !(await layout(e)).horizontalOverflow);
      assert(engine, 'no uncaught page errors', errors.length === 0, errors);
      await e.screenshot({ path: `${OUT}/screens/${engine}-390x844.png` });
      await context7.close();
    } catch (error) {
      record(engine, 'engine run', false, error.message.slice(0, 300));
    } finally {
      await engineBrowser?.close();
    }
  }
} finally {
  await browser.close();
  await server.stop();
  receipt.finishedAt = new Date().toISOString();
  receipt.summary = { checks: receipt.runs.length, passed: receipt.runs.filter(r => r.ok).length, failed: receipt.failures.length };
  await writeFile(`${OUT}/receipt-148.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.summary));
}
