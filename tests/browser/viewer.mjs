// Browser evidence for Studio #10: the in-project asset viewer's keyboard and
// deep-link contract. It uses the shared fictional fixture and never reaches a
// provider, publication or production binding.
import { ensureFixture } from './fixture.mjs';
import { serve, login, loadPlaywright, ORIGIN } from './harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/10-viewer';
await mkdir(`${OUT}/screens`, { recursive: true });
const pw = await loadPlaywright();
const fixture = await ensureFixture();
const server = await serve();
const receipt = { source: process.env.STUDIO_SOURCE_LABEL ?? 'working tree', fixture: { projectId: fixture.projectId }, startedAt: new Date().toISOString(), runs: [], failures: [] };
const record = (check, ok, detail) => {
  receipt.runs.push({ check, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) { receipt.failures.push({ check, detail }); console.log(`FAIL ${check}`, detail ?? ''); }
  else console.log(`ok   ${check}`);
};
const assert = (check, condition, detail) => record(check, Boolean(condition), detail);

const projectId = fixture.projectId;
const libraryHash = `#/p/${projectId}/library`;
const scrollAsset = fixture.clips.at(-1);
const viewerHash = `#/a/${projectId}/${scrollAsset.id}`;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], audio[controls], summary, [tabindex]:not([tabindex="-1"])';

const active = page => page.evaluate(() => ({
  action: document.activeElement?.getAttribute('data-action') ?? null,
  id: document.activeElement?.dataset?.id ?? null,
  text: (document.activeElement?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
  tag: document.activeElement?.tagName ?? null,
  insideViewer: Boolean(document.querySelector('[data-viewer]')?.contains(document.activeElement)),
}));
const openLibrary = async page => {
  await page.goto(`${ORIGIN}/${libraryHash}`, { waitUntil: 'networkidle' });
  await page.locator('.asset-grid [data-action="open-asset"].thumb').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
};
const waitForLibrary = page => page.locator('.asset-grid').waitFor({ timeout: 15_000 });
const waitForViewer = page => page.locator('[data-viewer]').waitFor({ timeout: 15_000 });

const browser = await pw.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await login(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message.slice(0, 200)));

  // ---------- 1. Open from the library, focus enters the viewer ----------
  await openLibrary(page);
  const opener = page.locator(`.asset-grid [data-action="open-asset"][data-id="${scrollAsset.id}"]`).last();
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Enter');
  await waitForViewer(page);
  await page.waitForTimeout(300);
  assert('open viewer hash is the asset route', await page.evaluate(() => location.hash) === viewerHash, await page.evaluate(() => location.hash));
  const opened = await active(page);
  assert('focus moves into the viewer on open', opened.action === 'close-viewer' && opened.insideViewer, opened);
  assert('a Close control is present and named', await page.getByRole('button', { name: 'Close the viewer' }).count() === 1);
  assert('Back to library remains present', await page.getByRole('link', { name: '← Back to library' }).count() === 1);
  const openedView = await page.evaluate(() => {
    const rect = document.querySelector('[data-action="close-viewer"]').getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewport: innerHeight, scrollY };
  });
  assert('the viewer starts at its controls with Close visible', openedView.scrollY === 0 && openedView.top >= 0 && openedView.bottom <= openedView.viewport, openedView);
  await page.screenshot({ path: `${OUT}/screens/viewer-1440x900.png` });

  // ---------- 2. Tab is contained; Shift+Tab wraps the other way ----------
  const focusEdges = await page.evaluate(selector => {
    const root = document.querySelector('[data-viewer]');
    const items = [...root.querySelectorAll(selector)].filter(element => element.getClientRects().length > 0);
    items.at(-1).focus();
    return { first: items[0].textContent.trim().replace(/\s+/g, ' ').slice(0, 40), last: items.at(-1).textContent.trim().replace(/\s+/g, ' ').slice(0, 40) };
  }, FOCUSABLE);
  await page.keyboard.press('Tab');
  let state = await active(page);
  assert('Tab from the last control wraps inside the viewer', state.insideViewer && state.text.startsWith('← Back to library'), { state, focusEdges });
  await page.keyboard.press('Shift+Tab');
  state = await active(page);
  assert('Shift+Tab from the first control wraps inside the viewer', state.insideViewer && state.text.startsWith(focusEdges.last.slice(0, 20)), { state, focusEdges });
  const tabEscapes = [];
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => Boolean(document.querySelector('[data-viewer]')?.contains(document.activeElement)));
    if (!inside) tabEscapes.push(index);
  }
  assert('eighteen Tab presses stay inside the viewer', tabEscapes.length === 0, tabEscapes);

  // ---------- 3. Escape closes, focus returns to the opener, scroll restores ----------
  await page.keyboard.press('Escape');
  await waitForLibrary(page);
  await page.waitForTimeout(500);
  assert('Escape returns to the library route', await page.evaluate(() => location.hash) === libraryHash, await page.evaluate(() => location.hash));
  const returned = await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return { action: element?.getAttribute('data-action'), id: element?.dataset?.id ?? null, text: (element?.textContent ?? '').trim(), ring: element?.classList.contains('viewer-return-focus') ?? false, outline: `${style.outlineStyle} ${style.outlineWidth}`, scrollY: window.scrollY };
  });
  assert('focus returns to the exact opener', returned.action === 'open-asset' && returned.id === scrollAsset.id && returned.text === 'Open', returned);
  assert('the returned opener shows a visible focus ring', returned.ring && /solid 3px/.test(returned.outline), returned);
  assert('the library scroll position is preserved', Math.abs(returned.scrollY - scrollBefore) <= 2, { before: scrollBefore, after: returned.scrollY });
  await page.screenshot({ path: `${OUT}/screens/library-return-focus-1440x900.png` });

  // ---------- 4. The Close button closes and restores focus ----------
  const thumb = page.locator(`.asset-grid [data-action="open-asset"].thumb[data-id="${scrollAsset.id}"]`);
  await thumb.click();
  await waitForViewer(page);
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Close the viewer' }).click();
  await waitForLibrary(page);
  await page.waitForTimeout(400);
  assert('Close returns to the library route', await page.evaluate(() => location.hash) === libraryHash);
  const afterClose = await active(page);
  assert('Close returns focus to the card it opened from', afterClose.action === 'open-asset' && afterClose.id === scrollAsset.id && afterClose.tag === 'BUTTON', afterClose);

  // ---------- 5. Back to library still works ----------
  await page.locator(`.asset-grid [data-action="open-asset"][data-id="${scrollAsset.id}"]`).last().click();
  await waitForViewer(page);
  await page.waitForTimeout(200);
  await page.getByRole('link', { name: '← Back to library' }).click();
  await waitForLibrary(page);
  await page.waitForTimeout(300);
  assert('Back to library still returns to the library', await page.evaluate(() => location.hash) === libraryHash);
  const afterBack = await active(page);
  assert('Back also restores the opener focus', afterBack.action === 'open-asset' && afterBack.id === scrollAsset.id, afterBack);

  // ---------- 6. Browser Back and Forward keep working ----------
  await page.locator(`.asset-grid [data-action="open-asset"][data-id="${scrollAsset.id}"]`).last().click();
  await waitForViewer(page);
  await page.goBack();
  await waitForLibrary(page);
  assert('browser Back returns to the library', await page.evaluate(() => location.hash) === libraryHash);
  await page.goForward();
  await waitForViewer(page);
  assert('browser Forward reopens the viewer', await page.evaluate(() => location.hash) === viewerHash);
  assert('Forward also moves focus into the viewer', (await active(page)).action === 'close-viewer');
  await page.keyboard.press('Escape');
  await waitForLibrary(page);
  await page.waitForTimeout(300);
  assert('Escape closes the forward-opened viewer', await page.evaluate(() => location.hash) === libraryHash);

  // ---------- 7. A malformed hash preserves the current route and explains ----------
  await page.evaluate(() => { location.hash = '#/not-a-studio-route'; });
  await page.waitForTimeout(500);
  const malformed = await page.evaluate(() => ({
    hash: location.hash,
    heading: document.querySelector('#app h1')?.textContent ?? '',
    library: Boolean(document.querySelector('.asset-grid')),
    toastHidden: document.querySelector('#toast')?.hidden ?? true,
    toast: document.querySelector('#toast')?.textContent ?? '',
  }));
  assert('a malformed hash keeps the current project page', malformed.library && malformed.heading.includes('Fictional workbench fixture'), malformed);
  assert('a malformed hash is replaced by the stable route', malformed.hash === libraryHash, malformed);
  assert('a malformed hash shows a short non-blocking message', !malformed.toastHidden && /wasn't recognised/.test(malformed.toast), malformed);

  // Boot with an unparseable deep link: home stays stable and says why.
  const bootPage = await context.newPage();
  await bootPage.goto(`${ORIGIN}/#/a/only-one-segment`, { waitUntil: 'networkidle' });
  await bootPage.waitForTimeout(600);
  const booted = await bootPage.evaluate(() => ({
    hash: location.hash,
    hasHome: Boolean(document.querySelector('#app h1, #creative-home')),
    toastHidden: document.querySelector('#toast')?.hidden ?? true,
    toast: document.querySelector('#toast')?.textContent ?? '',
  }));
  assert('a malformed deep link boots on a stable page', booted.hasHome && booted.hash === '#/', booted);
  assert('the malformed deep link explains itself on boot', !booted.toastHidden && /wasn't recognised/.test(booted.toast), booted);
  await bootPage.close();

  // ---------- 8. A valid deep link is unchanged ----------
  const image = fixture.images[1];
  const imageHash = `#/a/${projectId}/${image.id}`;
  const deep = await context.newPage();
  await deep.goto(`${ORIGIN}/${imageHash}`, { waitUntil: 'networkidle' });
  await waitForViewer(deep);
  await deep.waitForTimeout(300);
  assert('a valid deep link keeps its hash', await deep.evaluate(() => location.hash) === imageHash, await deep.evaluate(() => location.hash));
  assert('a valid deep link focuses the viewer', (await active(deep)).action === 'close-viewer');
  await deep.keyboard.press('Escape');
  await waitForLibrary(deep);
  await deep.waitForTimeout(300);
  assert('Escape leaves a deep-linked viewer on the library', await deep.evaluate(() => location.hash) === libraryHash);
  await deep.close();

  assert('no uncaught page errors', errors.length === 0, errors);
  await context.close();

  // ---------- 9. Phone viewport screenshot and viewer fit ----------
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, ignoreHTTPSErrors: true });
  await login(phoneContext);
  const phone = await phoneContext.newPage();
  await openLibrary(phone);
  await phone.locator(`.asset-grid [data-action="open-asset"].thumb[data-id="${scrollAsset.id}"]`).click();
  await waitForViewer(phone);
  await phone.waitForTimeout(400);
  const phoneFit = await phone.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    close: Boolean(document.querySelector('[data-action="close-viewer"]')),
    focused: document.activeElement?.getAttribute('data-action') ?? null,
  }));
  assert('390 viewer has no horizontal overflow', phoneFit.scrollWidth <= phoneFit.clientWidth + 1, phoneFit);
  assert('390 viewer exposes Close and starts focus there', phoneFit.close && phoneFit.focused === 'close-viewer', phoneFit);
  await phone.screenshot({ path: `${OUT}/screens/viewer-390x844.png` });
  await phone.keyboard.press('Escape');
  await waitForLibrary(phone);
  await phone.waitForTimeout(400);
  assert('390 Escape closes the viewer', await phone.evaluate(() => location.hash) === libraryHash);
  await phone.screenshot({ path: `${OUT}/screens/library-after-escape-390x844.png` });
  await phoneContext.close();

  // ---------- 10. The no-bundle fallback viewer keeps the same contract ----------
  const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await fallbackContext.route('**/creative/home.js*', route => route.abort());
  await login(fallbackContext);
  const fallback = await fallbackContext.newPage();
  await openLibrary(fallback);
  const fallbackThumb = fallback.locator(`.asset-grid [data-action="open-asset"].thumb[data-id="${scrollAsset.id}"]`);
  await fallbackThumb.scrollIntoViewIfNeeded();
  await fallbackThumb.click();
  await waitForViewer(fallback);
  await fallback.waitForTimeout(300);
  assert('fallback viewer exposes the named Close control', await fallback.getByRole('button', { name: 'Close the viewer' }).count() === 1);
  assert('fallback viewer moves focus to Close', (await active(fallback)).action === 'close-viewer');
  await fallback.keyboard.press('Tab');
  assert('fallback viewer keeps Tab inside', (await active(fallback)).insideViewer);
  await fallback.keyboard.press('Escape');
  await waitForLibrary(fallback);
  await fallback.waitForTimeout(400);
  assert('fallback Escape closes to the library', await fallback.evaluate(() => location.hash) === libraryHash);
  const fallbackReturn = await active(fallback);
  assert('fallback Escape restores the opener', fallbackReturn.action === 'open-asset' && fallbackReturn.id === scrollAsset.id, fallbackReturn);
  await fallbackContext.close();
} finally {
  await browser.close();
  await server.stop();
  receipt.finishedAt = new Date().toISOString();
  receipt.summary = { checks: receipt.runs.length, passed: receipt.runs.filter(run => run.ok).length, failed: receipt.failures.length };
  await writeFile(`${OUT}/receipt-10-viewer.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.summary));
}
