import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shell } from '../src/lib/ui.mjs';

test('the local app launcher uses only a configured safe Composer origin', () => {
  const configured = shell({revision:'a1', composerOrigin:'https://composer.example/', session:{mode:'bridge', actorName:'dean', workspaceName:'dean'}});
  assert.match(configured, /data-composer-home="https:\/\/composer\.example\/"/);
  assert.match(configured, /src="\/brand\/launcher\.js"/);
  assert.match(configured, /Opened from App Composer|Standalone owner session/);
  assert.match(configured, /href="https:\/\/composer\.example\/media-studio\/studio">App Composer/);
  assert.doesNotMatch(configured, /dean · dean/);
  assert.doesNotMatch(shell({revision:'a1'}), /data-open-apps/);
  assert.doesNotMatch(shell({revision:'a1', composerOrigin:'https:\/\/user:pass@example.com'}), /data-open-apps/);
  assert.doesNotMatch(shell({revision:'a1', composerOrigin:'javascript:alert(1)'}), /data-open-apps/);
});

test('the launcher trigger always ships with the dialog it controls', () => {
  const html = shell({revision:'a1', composerOrigin:'https://composer.example/', session:{mode:'owner', actorName:'owner'}});
  // The trigger is the dialog's control, and both live in the same shell.
  assert.match(html, /class="app-launcher"/);
  assert.match(html, /data-open-apps aria-controls="app-navigation"/);
  assert.match(html, /id="app-navigation" aria-labelledby="app-navigation-title"/);
  assert.match(html, /data-launcher-scope="local"/);
  // Studio-local destinations, not Composer-only routes.
  assert.match(html, /href="#\/"><span>Studio projects/);
  assert.match(html, /href="\/gallery"/);
  assert.match(html, /href="\/help"/);
  assert.doesNotMatch(html, /href="\/init"|href="\/discover"|href="\/collections"|href="\/me"/);
  // No dialog, no trigger: a bare signed-in page never offers a dead control.
  const bare = shell({revision:'a1', session:{mode:'owner'}});
  assert.doesNotMatch(bare, /data-open-apps/);
  assert.doesNotMatch(bare, /id="app-navigation"/);
});
