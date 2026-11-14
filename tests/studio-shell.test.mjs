import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shell } from '../src/lib/ui.mjs';

test('the local app launcher uses only a configured safe Composer origin', () => {
  const configured = shell({revision:'a1', composerOrigin:'https://composer.example/', session:{actorName:'dean', workspaceName:'dean'}});
  assert.match(configured, /data-composer-home="https:\/\/composer\.example\/"/);
  assert.match(configured, /src="\/brand\/launcher\.js"/);
  assert.match(configured, /Opened from App Composer|Standalone owner session/);
  assert.doesNotMatch(configured, /dean · dean/);
  assert.doesNotMatch(shell({revision:'a1'}), /data-open-apps/);
  assert.doesNotMatch(shell({revision:'a1', composerOrigin:'https:\/\/user:pass@example.com'}), /data-open-apps/);
  assert.doesNotMatch(shell({revision:'a1', composerOrigin:'javascript:alert(1)'}), /data-open-apps/);
});
