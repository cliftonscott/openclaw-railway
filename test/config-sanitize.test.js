import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeConfig } from '../src/config-sanitize.js';

test('sanitizeConfig removes stale memory-core plugin config', () => {
  const config = {
    plugins: {
      entries: {
        'memory-core': {
          config: {
            dreaming: {
              enabled: true,
            },
          },
        },
        slack: {
          enabled: true,
        },
      },
    },
  };

  const result = sanitizeConfig(config);

  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, [
    'plugins.entries.memory-core.config removed',
    'plugins.entries.memory-core removed (empty)',
  ]);
  assert.equal(config.plugins.entries['memory-core'], undefined);
  assert.deepEqual(config.plugins.entries.slack, { enabled: true });
});

test('sanitizeConfig preserves non-empty memory-core plugin entries', () => {
  const config = {
    plugins: {
      entries: {
        'memory-core': {
          enabled: true,
          config: {
            dreaming: {
              enabled: true,
            },
          },
        },
      },
    },
  };

  const result = sanitizeConfig(config);

  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, ['plugins.entries.memory-core.config removed']);
  assert.deepEqual(config.plugins.entries['memory-core'], { enabled: true });
});
