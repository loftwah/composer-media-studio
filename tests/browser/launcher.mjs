import { serve, login, loadPlaywright, ORIGIN } from './harness.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/launcher';
await mkdir(`${OUT}/screens`, { recursive: true });
const pw = await loadPlaywright();
const server = await serve();
const browser = await pw.chromium.launch({ headless: true });
const receipt = { checks: [], failures: [] };
const check = (name, ok, detail) => { receipt.checks.push({ name, ok, detail }); if (!ok) { receipt.failures.push({ name, detail }); console.log('FAIL', name, detail ?? ''); } else console.log('ok  ', name); };

// Signed-out: no trigger at all, so no dead control.
{
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  check('signed-out shell has no Apps trigger', (await page.locator('[data-open-apps]').count()) === 0);
  check('signed-out shell has no launcher dialog', (await page.locator('#app-navigation').count()) === 0);
  await context.close();
}
// Signed-in: the trigger opens one real modal dialog with Studio-local destinations.
{
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 }, ignoreHTTPSErrors: true });
  await login(context);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const trigger = page.locator('[data-open-apps]');
  check('trigger and dialog are both present', (await trigger.count()) === 1 && (await page.locator('#app-navigation').count()) === 1);
  check('aria-controls points at a real element', await trigger.evaluate(el => Boolean(document.getElementById(el.getAttribute('aria-controls')))));
  check('closed state is expanded=false', (await trigger.getAttribute('aria-expanded')) === 'false');
  await page.screenshot({ path: `${OUT}/screens/launcher-closed-1728x1117.png` });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page.locator('#app-navigation[open]').waitFor({ timeout: 5000 });
  check('keyboard Enter opens the dialog', await page.locator('#app-navigation').evaluate(d => d.open));
  check('expanded follows the dialog', (await trigger.getAttribute('aria-expanded')) === 'true');
  const text = await page.locator('#app-navigation').innerText();
  check('dialog is labelled Apps and shortcuts', text.includes('Apps and shortcuts'));
  const hrefs = await page.locator('#app-navigation a').evaluateAll(els => els.map(a => a.getAttribute('href')));
  check('Studio destinations are listed', ['#/', '/gallery', '/help'].every(h => hrefs.includes(h)), hrefs.slice(0, 10));
  check('no Composer-only task routes are listed', !hrefs.some(h => ['/discover', '/collections', '/me', '/platform', '/init', '/docs'].some(p => h === p || h?.endsWith(p))), hrefs);
  check('the launcher footer keeps keyboard hints', text.includes('Navigate') && text.includes('Close'));
  check('search field is present and labelled', (await page.locator('#app-navigation input[type=search]').count()) === 1);
  check('Close control is present', (await page.locator('#app-navigation [data-close-apps]').count()) === 1);
  await page.screenshot({ path: `${OUT}/screens/launcher-open-1728x1117.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('Escape closes the dialog', !(await page.locator('#app-navigation').evaluate(d => d.open)));
  check('focus returns to the trigger', await page.evaluate(() => document.activeElement?.hasAttribute('data-open-apps')));
  // Mouse open + Close button.
  await trigger.click();
  await page.locator('#app-navigation[open]').waitFor();
  check('mouse click opens the dialog', await page.locator('#app-navigation').evaluate(d => d.open));
  await page.locator('#app-navigation [data-close-apps]').click();
  await page.waitForTimeout(250);
  check('Close button closes the dialog', !(await page.locator('#app-navigation').evaluate(d => d.open)));
  check('focus returns after Close', await page.evaluate(() => document.activeElement?.hasAttribute('data-open-apps')));
  // 390 phone: modal fits the visual viewport, no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await page.waitForTimeout(300);
  const phone = await page.evaluate(() => {
    const d = document.querySelector('#app-navigation');
    const r = d.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, innerWidth, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
  check('phone dialog fits the viewport', phone.left >= 0 && phone.right <= phone.innerWidth + 0.5, phone);
  check('phone page has no horizontal overflow with the menu open', phone.scrollWidth <= phone.clientWidth + 1, phone);
  await page.screenshot({ path: `${OUT}/screens/launcher-open-390x844.png` });
  await page.keyboard.press('Escape');
  await context.close();
}
// Orphan guard: a shell with a trigger but no dialog must not ship a dead control.
{
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/brand/launcher.js`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.setContent(`<!doctype html><html><body><div class="app-launcher"><button type="button" data-open-apps>Apps <kbd>⌘ K</kbd></button></div><script src="${ORIGIN}/brand/launcher.js"></script></body></html>`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check('an orphan trigger is removed, not left dead', (await page.locator('[data-open-apps]').count()) === 0);
  await context.close();
}
await browser.close();
await server.stop();
await writeFile(`${OUT}/receipt-launcher.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ checks: receipt.checks.length, failed: receipt.failures.length }));
