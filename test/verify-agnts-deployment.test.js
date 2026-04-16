import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractTrailingJson,
  parseDeploymentList,
  summarizeClusterVerification,
} from '../src/verify-agnts-deployment.js';

test('parseDeploymentList extracts deployment rows', () => {
  const output = [
    'Recent Deployments',
    '  58261e78-968f-422f-945b-824389bbbbb3 | BUILDING | 2026-04-16 10:58:09 -05:00',
    '  3136adbc-9224-4256-a28a-46d5c321912f | SUCCESS | 2026-04-16 10:43:23 -05:00',
  ].join('\n');

  assert.deepEqual(parseDeploymentList(output), [
    {
      id: '58261e78-968f-422f-945b-824389bbbbb3',
      status: 'BUILDING',
      timestamp: '2026-04-16 10:58:09 -05:00',
    },
    {
      id: '3136adbc-9224-4256-a28a-46d5c321912f',
      status: 'SUCCESS',
      timestamp: '2026-04-16 10:43:23 -05:00',
    },
  ]);
});

test('summarizeClusterVerification recognizes live command execution', () => {
  const payload = {
    meta: {
      toolSummary: {
        calls: 3,
        failures: 0,
      },
      finalAssistantVisibleText: [
        'I executed the live cluster-watch path: `node /app/agnts-tooling/dist/runClusterWatchReadiness.js --stdout-only`, then `node /app/agnts-tooling/dist/runClusterWatch.js --stdout-only`.',
        'Behavioral cluster 3 is degrading first.',
      ].join('\n\n'),
    },
  };

  assert.deepEqual(summarizeClusterVerification(payload), {
    ok: true,
    clusterId: 3,
    toolFailures: 0,
    toolCalls: 3,
    snippet: payload.meta.finalAssistantVisibleText,
  });
});

test('extractTrailingJson strips ansi logs before final json payload', () => {
  const output = [
    '\u001b[31mRegistered plugin command: /dreaming (plugin: memory-core)\u001b[39m',
    'Gateway agent failed; falling back to embedded',
    '{"payloads":[{"text":"ok"}],"meta":{"toolSummary":{"calls":3,"failures":0},"finalAssistantVisibleText":"Executed command path: `node /app/agnts-tooling/dist/runClusterWatchReadiness.js --stdout-only`"}}',
  ].join('\n');

  assert.deepEqual(JSON.parse(extractTrailingJson(output)), {
    payloads: [{ text: 'ok' }],
    meta: {
      toolSummary: { calls: 3, failures: 0 },
      finalAssistantVisibleText: 'Executed command path: `node /app/agnts-tooling/dist/runClusterWatchReadiness.js --stdout-only`',
    },
  });
});
