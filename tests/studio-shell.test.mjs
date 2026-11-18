import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shell } from '../src/lib/ui.mjs';

test('the local app launcher uses only a configured safe Composer origin', () => {
  const configured = shell({revision:'a1', composerOrigin:'https://composer.example/', session:{mode:'bridge', actorName:'dean', workspaceName:'dean'}});
  assert.match(configured, /data-composer-home="https:\/\/composer\.example\/"/);
  assert.match(configured, /src="\/brand\/launcher\.js"/);
  assert.match(configured, /Opened from App Composer|Standalone owner session/);
  assert.match(configured, /href="https:\/\/composer\.example\/">App Composer/);
  assert.doesNotMatch(configured, /dean · dean/);
  assert.doesNotMatch(shell({revision:'a1'}), /data-open-apps/);
  assert.doesNotMatch(shell({revision:'a1', composerOrigin:'https:\/\/user:pass@example.com'}), /data-open-apps/);
  assert.doesNotMatch(shell({revision:'a1', composerOrigin:'javascript:alert(1)'}), /data-open-apps/);
});

test('the shell publishes only an explicit, escaped Director name', () => {
  const named = shell({ revision: 'a1', directorName: 'Nova' });
  assert.match(named, /<meta name="studio-director-name" content="Nova">/);
  const neutral = shell({ revision: 'a1', directorName: null });
  assert.doesNotMatch(neutral, /studio-director-name/);
  // The worker environment can set the public display name without a rebuild.
  const previous = process.env.DIRECTOR_NAME;
  try {
    process.env.DIRECTOR_NAME = 'Nova <studio>';
    assert.match(shell({ revision: 'a1' }), /content="Nova &lt;studio&gt;"/);
    // The browser module owns the neutral default; the shell only transports.
    process.env.DIRECTOR_NAME = '   ';
    assert.doesNotMatch(shell({ revision: 'a1' }), /studio-director-name/);
  } finally {
    if (previous === undefined) delete process.env.DIRECTOR_NAME;
    else process.env.DIRECTOR_NAME = previous;
  }
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
  assert.match(html, /href="https:\/\/composer-launch-kit\.loftwah\.workers\.dev\/\?operation=icons" target="_blank" rel="noopener"><span>Make site icons/);
  assert.doesNotMatch(html, /href="\/init"|href="\/discover"|href="\/collections"|href="\/me"/);
  // No dialog, no trigger: a bare signed-in page never offers a dead control.
  const bare = shell({revision:'a1', session:{mode:'owner'}});
  assert.doesNotMatch(bare, /data-open-apps/);
  assert.doesNotMatch(bare, /id="app-navigation"/);
});
