import { serve, login, loadPlaywright, ORIGIN, api } from './harness.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

// One real Workers AI text call per run (the 390 ask). The error path is an
// intercepted 502 so no provider is called twice. No media provider is touched.
const OUT = process.env.STUDIO_BROWSER_OUT ?? 'output/browser-evidence/director';
await mkdir(`${OUT}/screens`, { recursive: true });
const pw = await loadPlaywright();
const server = await serve({ aiRemote: true });
const browser = await pw.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await login(context);
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 300)));
const receipt = { fixture: { projectId: server.fixture.projectId, planId: server.fixture.plan.id }, checks: [], failures: [], screens: [] };
const check = (name, ok, detail) => {
  receipt.checks.push({ name, ok, detail });
  if (!ok) { receipt.failures.push({ name, detail }); console.log('FAIL', name, detail ?? ''); }
  else console.log('ok  ', name);
};
const shot = async (name, target = page) => {
  const path = `${OUT}/screens/${name}.png`;
  await target.screenshot({ path });
  receipt.screens.push(path);
  return path;
};
const panel = page.locator('[data-director="chat"]');
const agent = page.locator('[data-director="agent"]');
const askButton = panel.locator('.director-ask-row button');
const planButton = () => page.getByRole('button', { name: /Fictional six-scene film/ });
const openPlan = async () => {
  await page.locator('.song-plan-list').waitFor({ timeout: 30_000 });
  await planButton().click();
  await page.waitForTimeout(700);
};
const css = (locator, property) => locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

let runError = null;
try {
  const before = (await api(context, `/api/projects/${server.fixture.projectId}/song-plans`)).plans.find(p => p.id === server.fixture.plan.id);
  await page.goto(`${ORIGIN}/#/p/${server.fixture.projectId}/assemble`, { waitUntil: 'networkidle' });
  await openPlan();

  const revisionShown = await page.locator('.song-editor-heading p.small').innerText();
  check('the saved plan reopens at the server revision', revisionShown.includes(`Revision ${before.revision}`), revisionShown);

  // Neutral identity and the real page outline (h2 workbench → h3 plan → h4
  // panel sections). Making the panel h3 would put the later h4 Scenes section
  // under the Director instead of under the plan, so the h4 is deliberate.
  const neutralTitle = await page.locator('#director-title').innerText();
  const lede = await panel.locator('.director-lede').innerText();
  check('the Director renders the neutral Creative Director title', neutralTitle === 'Creative Director', neutralTitle);
  check('the lede reads naturally with no placeholder name', lede.includes('The Creative Director reads this saved plan') && !/undefined|null/i.test(lede), lede.slice(0, 180));
  check('the connected-agent section is present', (await agent.locator('h4').innerText()) === 'Your connected agent');
  const outline = await page.evaluate(() => {
    const workbench = document.querySelector('#director-title')?.closest('.song-plans');
    const headings = [...workbench.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(heading => ({ tag: heading.tagName, text: heading.textContent.trim().slice(0, 40) }));
    return { headings, first: headings[0]?.tag ?? null, director: document.querySelector('#director-title')?.tagName ?? null, plan: workbench.querySelector('.song-editor-heading h3')?.textContent ?? null };
  });
  const skipped = outline.headings.some((heading, index) => index > 0 && Number(heading.tag[1]) - Number(outline.headings[index - 1].tag[1]) > 1);
  check('the h2 workbench → h3 plan → h4 Director outline skips no level', outline.first === 'H2' && outline.director === 'H4' && Boolean(outline.plan) && !skipped, outline);
  await panel.scrollIntoViewIfNeeded();
  await shot('director-1440-neutral', panel);

  // Error state: a failed ask is announced, visually distinct, and leaves focus
  // on the ask control. The route failure is local; the server is never called.
  await panel.getByLabel('Scene 2').check();
  const request = 'Make scene 2 warmer and slower, and keep the same take.';
  const ask = panel.getByLabel('What should change?');
  await ask.fill(request);
  const failDirector = async route => {
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Creative direction did not answer. Nothing was changed; try again in a moment.' } }) });
  };
  await page.route('**/director', failDirector);
  await askButton.click();
  const alert = panel.getByRole('alert');
  await alert.waitFor({ timeout: 5_000 });
  const alertText = await alert.innerText();
  const alertRole = await alert.getAttribute('role');
  const alertBackground = await css(alert, 'background-color');
  check('a failed ask is announced with role=alert and honest copy', alertRole === 'alert' && /did not answer/.test(alertText) && /Nothing was changed/.test(alertText), alertText);
  check('a failed ask keeps focus on the ask control', await page.evaluate(() => document.activeElement === document.querySelector('.director-ask-row button')));
  check('the error state has its own surface', alertBackground !== 'rgba(0, 0, 0, 0)' && alertBackground !== await css(panel, 'background-color'), alertBackground);
  await page.unroute('**/director', failDirector);
  await panel.scrollIntoViewIfNeeded();
  await shot('director-1440-error');
  const afterError = (await api(context, `/api/projects/${server.fixture.projectId}/song-plans`)).plans.find(p => p.id === before.id);
  check('the intercepted failure changed nothing', afterError.revision === before.revision, afterError.revision);

  // 390 × 844: no overflow, reachable panel, headings/roles, keyboard and the
  // real ask flow. The AI call happens here so the phone path is the real one.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('390×844 has no horizontal overflow', !overflow390);
  await panel.scrollIntoViewIfNeeded();
  const panelOverflow390 = await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1);
  check('390×844 keeps the Director panel inside its column', !panelOverflow390);
  check('390×844 shows the panel and its neutral heading', await panel.isVisible() && (await page.locator('#director-title').innerText()) === 'Creative Director');
  check('390×844 keeps the panel roles and labels', await panel.getAttribute('aria-labelledby') === 'director-title' && await panel.getByLabel('What should change?').isVisible());
  await ask.focus();
  await page.keyboard.press('Tab');
  check('keyboard reaches the ask action at 390×844', await page.evaluate(() => document.activeElement === document.querySelector('.director-ask-row button')));
  await ask.fill(request); // clears the intercepted error
  const slowDirector = async route => { await new Promise(resolve => setTimeout(resolve, 900)); await route.continue(); };
  await page.route('**/director', slowDirector);
  await askButton.click();
  const busySeen = await page.waitForFunction(() => document.querySelector('[data-director="chat"]')?.getAttribute('aria-busy') === 'true' && document.querySelector('.director-ask-row button')?.getAttribute('aria-busy') === 'true', { timeout: 5_000 }).then(() => true, () => false);
  check('asking sets aria-busy on the panel and the ask button', busySeen);
  const askingStatus = panel.locator('.director-status.is-asking');
  await askingStatus.waitFor({ timeout: 2_000 }).catch(() => {});
  const askingRole = await askingStatus.getAttribute('role').catch(() => null);
  const askingText = await askingStatus.innerText().catch(() => '');
  const askingBackground = await css(askingStatus, 'background-color').catch(() => '');
  check('asking is announced with role=status and the saved revision', askingRole === 'status' && /Reading saved plan revision/.test(askingText), askingText);
  check('asking keeps focus on the ask control', await page.evaluate(() => document.activeElement === document.querySelector('.director-ask-row button')));
  check('the asking state has its own surface', Boolean(askingBackground) && askingBackground !== await css(panel, 'background-color'), askingBackground);
  await panel.scrollIntoViewIfNeeded();
  await shot('director-390-asking');

  await panel.getByText(/proposed \d+ direction change/).waitFor({ timeout: 60_000 });
  await page.unroute('**/director', slowDirector);
  const status = await panel.getByText(/proposed \d+ direction change/).innerText();
  check('a real Workers AI reply produced a typed proposal', /proposed 1 direction change/.test(status), status);
  check('the proposal says nothing was applied, generated, saved or charged', /Nothing has been applied, generated, saved or charged/.test(status), status);
  const proposalStatus = panel.locator('.director-status.is-proposed').first();
  const proposalRole = await proposalStatus.getAttribute('role');
  const proposalBackground = await css(proposalStatus, 'background-color');
  check('the proposed state is announced and visually distinct', proposalRole === 'status' && proposalBackground !== askingBackground && proposalBackground !== await css(panel, 'background-color'), proposalBackground);
  const focusMoved = await page.waitForFunction(() => document.activeElement?.id === 'director-review-title', { timeout: 5_000 }).then(() => true, () => false);
  check('a finished ask moves focus to the proposal heading', focusMoved);
  check('aria-busy is cleared after the answer', await panel.getAttribute('aria-busy') === null && await askButton.getAttribute('aria-busy') === null);
  await page.locator('#director-review-title').scrollIntoViewIfNeeded();
  await shot('director-390-proposal');
  const review = page.locator('[data-director="review"]');
  const reviewText = await review.innerText();
  check('the proposal shows before and after', reviewText.includes('Before') && reviewText.includes('After'), reviewText.slice(0, 160));
  const afterText = (await review.locator('dd').nth(1).innerText()).split(' · reference ')[0].trim();
  check('the after direction is a real rewrite, not the saved text', afterText !== before.scenes[1].direction && afterText.length > 20, afterText);
  check('the proposal is scoped to the chosen scene', reviewText.toLowerCase().includes('scene 2') && !reviewText.toLowerCase().includes('scene 1'), reviewText.slice(0, 120));

  // 1440 pass: the same proposal is reviewed and applied at desktop width.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  await review.scrollIntoViewIfNeeded();
  await shot('director-1440-proposal');
  const mid = (await api(context, `/api/projects/${server.fixture.projectId}/song-plans`)).plans.find(p => p.id === before.id);
  check('asking the Director saved nothing', mid.revision === before.revision && mid.scenes[1].direction === before.scenes[1].direction, { revision: mid.revision });
  const projectState = await api(context, `/api/projects/${server.fixture.projectId}`);
  check('no generation or job was created by the conversation', projectState.generations.length === 0, projectState.generations.length);

  await review.getByRole('button', { name: /Apply 1 of 1 changes? to draft/ }).click();
  const applied = page.locator('[data-director="applied"]');
  await applied.waitFor({ timeout: 5_000 });
  const appliedText = await applied.innerText();
  const appliedRole = await applied.getAttribute('role');
  const appliedBackground = await css(applied, 'background-color');
  check('applying announces the draft-only receipt with role=status', appliedRole === 'status' && /Applied to this draft — not saved/.test(appliedText) && /Nothing was generated or charged/.test(appliedText), appliedText);
  check('the applied state is visually distinct', appliedBackground !== proposalBackground && appliedBackground !== askingBackground, appliedBackground);
  const receiptFocused = await page.waitForFunction(() => document.activeElement === document.querySelector('[data-director="applied"]'), { timeout: 5_000 }).then(() => true, () => false);
  check('applying moves focus to the receipt', receiptFocused);
  check('apply changes the draft only', /Unsaved changes/.test(await page.locator('.song-editor-heading').innerText()));
  const stillSaved = (await api(context, `/api/projects/${server.fixture.projectId}/song-plans`)).plans.find(p => p.id === before.id);
  check('the saved plan is still untouched before save', stillSaved.revision === before.revision, stillSaved.revision);
  await applied.scrollIntoViewIfNeeded();
  await shot('director-1440-applied');

  await page.getByRole('button', { name: 'Save scene plan' }).click();
  await page.getByText('Scene plan saved.').waitFor({ timeout: 15_000 });
  const saved = (await api(context, `/api/projects/${server.fixture.projectId}/song-plans`)).plans.find(p => p.id === before.id);
  check('saving the draft stores exactly one new revision', saved.revision === before.revision + 1, saved.revision);
  check('the saved direction is the reviewed one', saved.scenes[1].direction === afterText, { afterText, saved: saved.scenes[1].direction });
  check('the selected take is unchanged', saved.scenes[1].selectedTakeId === before.scenes[1].selectedTakeId);
  check('the reference is unchanged', saved.scenes[1].referenceAssetId === before.scenes[1].referenceAssetId);
  check('timing is unchanged', saved.scenes[1].startMs === before.scenes[1].startMs && saved.scenes[1].endMs === before.scenes[1].endMs);
  check('captions are unchanged', JSON.stringify(saved.captions) === JSON.stringify(before.captions));
  check('other scenes are unchanged', JSON.stringify(saved.scenes.filter((_, i) => i !== 1)) === JSON.stringify(before.scenes.filter((_, i) => i !== 1)));

  await page.reload({ waitUntil: 'networkidle' });
  await openPlan();
  const reopenedHeading = await page.locator('.song-editor-heading p.small').innerText();
  check('reload reopens the same saved revision', reopenedHeading.includes(`Revision ${saved.revision}`), reopenedHeading);
  const reopenedDirection = await page.locator('.song-scenes textarea').nth(1).inputValue();
  check('the reopened scene shows the applied direction', reopenedDirection === afterText, { reopenedDirection, afterText });
  const apiRead = (await api(context, `/api/projects/${server.fixture.projectId}/song-plans`)).plans.find(p => p.id === saved.id);
  check('the project API returns the same revision', apiRead.revision === saved.revision && apiRead.scenes[1].direction === afterText);

  // Unsaved text is labelled, local to this tab and restored after a reload.
  const intent = agent.getByLabel(/What would you like to change/);
  const draftText = 'Keep the final scene quiet and let the room tone carry it.';
  await intent.fill(draftText);
  const note = agent.locator('[data-director-draft="unsaved"]');
  const noteText = await note.innerText();
  check('unsaved agent text is visibly labelled as local to this browser', /Kept in this browser tab only/.test(noteText) && /does not send this text/.test(noteText), noteText);
  await page.reload({ waitUntil: 'networkidle' });
  await openPlan();
  const restoredIntent = await agent.getByLabel(/What would you like to change/).inputValue();
  check('the unsaved agent draft survives a reload and panel remount', restoredIntent === draftText, restoredIntent);
  await panel.scrollIntoViewIfNeeded();
  await shot('director-1440-draft-restored');

  // A white-label installation may publish a name at runtime. The role stays
  // Creative Director and the neutral default returns when the name is absent.
  const injectName = async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace('</head>', '<meta name="studio-director-name" content="Nova"></head>');
    await route.fulfill({ response, body });
  };
  await page.route('**/*', injectName);
  await page.reload({ waitUntil: 'networkidle' });
  await openPlan();
  const namedTitle = await page.locator('#director-title').innerText();
  const namedLede = await panel.locator('.director-lede').innerText();
  const namedAgent = await agent.locator('.director-agent-head p').innerText();
  check('an installation name renders as "Nova — your Creative Director"', namedTitle === 'Nova — your Creative Director', namedTitle);
  check('the lede and agent copy use the installation name naturally', namedLede.includes('Nova reads this saved plan') && namedAgent.includes('separate from Nova'), { namedLede: namedLede.slice(0, 120), namedAgent: namedAgent.slice(0, 120) });
  await panel.scrollIntoViewIfNeeded();
  await shot('director-1440-named', panel);
  await page.unroute('**/*', injectName);
  await page.reload({ waitUntil: 'networkidle' });
  await openPlan();
  check('an unset name returns to the neutral title with no placeholder', (await page.locator('#director-title').innerText()) === 'Creative Director');

  // The bounded store keeps only four plans, evicting the least recently used.
  await page.evaluate(() => {
    const entries = {};
    for (let index = 1; index <= 6; index += 1) entries[`prj_seed:plan_${index}`] = { proposal: '', intent: `seed ${index}`, touchedAt: 1000 + index };
    sessionStorage.setItem('studio.director.drafts.v1', JSON.stringify({ version: 1, entries }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await openPlan();
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => {
    const raw = sessionStorage.getItem('studio.director.drafts.v1');
    return raw ? JSON.parse(raw) : null;
  });
  const storedKeys = stored?.entries ? Object.keys(stored.entries) : [];
  check('the unsaved store is bounded to four plans', storedKeys.length === 4, storedKeys);
  check('the least recently used plans are evicted first', !storedKeys.includes('prj_seed:plan_1') && !storedKeys.includes('prj_seed:plan_2') && storedKeys.includes('prj_seed:plan_6'), storedKeys);
  check('the bounded store does not leak another plan into this panel', (await agent.getByLabel(/What would you like to change/).inputValue()) === '');

  // Final phone reopen after the stored drafts were cleared.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await panel.scrollIntoViewIfNeeded();
  const finalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('390×844 reopen still has no horizontal overflow', !finalOverflow);
  check('390×844 reopen still shows the neutral Director', await panel.isVisible() && (await page.locator('#director-title').innerText()) === 'Creative Director');
  await shot('director-390-reopen');
} catch (error) {
  runError = error;
  console.log('RUN ERROR', error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  await server.stop();
}

if (runError) receipt.failures.push({ name: 'run', detail: runError instanceof Error ? runError.message : String(runError) });
await writeFile(`${OUT}/receipt-director.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ checks: receipt.checks.length, passed: receipt.checks.filter(item => item.ok).length, failed: receipt.failures.length, screens: receipt.screens.length }));
if (receipt.failures.length) process.exitCode = 1;
