import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from './helpers/server-harness.js';
import {
  bootstrapAgntsRuntime,
  buildAgntsManagedBlock,
  ensureClusterWatchCron,
  ensureAgntsWorkspaceBootstrap,
  upsertClusterWatchJobsContent,
} from '../src/agnts-bootstrap.js';

function createEnv(overrides = {}) {
  return {
    AGNTS_ADMIN_CLIENT_ID: 'test-client-id',
    AGNTS_ADMIN_CLIENT_SECRET: 'test-client-secret',
    ...overrides,
  };
}

async function waitForFile(pathname, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(pathname)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file: ${pathname}`);
}

test('ensureAgntsWorkspaceBootstrap creates managed AGNTS.md and AGENTS.md blocks', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-workspace-'));
  const result = ensureAgntsWorkspaceBootstrap(workspaceDir, createEnv());
  const agntsPath = join(workspaceDir, 'AGNTS.md');
  const agentsPath = join(workspaceDir, 'AGENTS.md');

  assert.equal(result.changed, true);
  assert.equal(existsSync(agntsPath), true);
  assert.equal(existsSync(agentsPath), true);
  assert.equal(result.targets.length, 2);

  for (const pathname of [agntsPath, agentsPath]) {
    const content = readFileSync(pathname, 'utf8');
    assert.match(content, /## AGNTS admin API auth/);
    assert.match(content, /## AGNTS bundled skills/);
    assert.match(content, /## AGNTS cluster triage/);
    assert.match(content, /agnts_cluster_watch/);
    assert.match(content, /agnts_cluster_triage/);
    assert.match(content, /runClusterWatchReadiness\.js/);
    assert.match(content, /runClusterWatchMonitor\.js/);
  }
});

test('ensureAgntsWorkspaceBootstrap replaces stale AGNTS sections without duplicating them', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-workspace-'));
  const bootstrapPath = join(workspaceDir, 'AGNTS.md');
  writeFileSync(bootstrapPath, [
    '# AGNTS',
    '',
    'Keep this custom note.',
    '',
    '## AGNTS admin API auth',
    '',
    'stale auth section',
    '',
    '## AGNTS cluster triage',
    '',
    'stale cluster section',
    '',
  ].join('\n'));

  ensureAgntsWorkspaceBootstrap(workspaceDir, createEnv());
  const content = readFileSync(bootstrapPath, 'utf8');

  assert.equal((content.match(/## AGNTS admin API auth/g) ?? []).length, 1);
  assert.equal((content.match(/## AGNTS cluster triage/g) ?? []).length, 1);
  assert.match(content, /Keep this custom note\./);
  assert.doesNotMatch(content, /stale auth section/);
  assert.doesNotMatch(content, /stale cluster section/);
});

test('upsertClusterWatchJobsContent upserts the AGNTS cluster watch job', () => {
  const original = JSON.stringify([
    { name: 'existing-job', schedule: '*/5 * * * *', enabled: true },
    { name: 'agnts-cluster-watch', schedule: '* * * * *', enabled: false },
  ], null, 2);

  const updated = upsertClusterWatchJobsContent(original, createEnv({
    AGNTS_CLUSTER_WATCH_SCHEDULE: '0 * * * *',
    AGNTS_CLUSTER_WATCH_CHANNEL: '#alerts',
  }));
  const parsed = JSON.parse(updated);
  const agntsJob = parsed.find((job) => job.name === 'agnts-cluster-watch');

  assert.equal(parsed.length, 2);
  assert.deepEqual(agntsJob.schedule, {
    kind: 'cron',
    expr: '0 * * * *',
    tz: 'UTC',
  });
  assert.equal(agntsJob.enabled, true);
  assert.equal(agntsJob.delivery.channel, 'slack');
  assert.equal(agntsJob.delivery.to, '#alerts');
  assert.equal(agntsJob.delivery.bestEffort, false);
  assert.match(agntsJob.payload.message, /runClusterWatchMonitor\.js/);
});

test('ensureClusterWatchCron writes jobs.json in the configured state dir', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-state-'));
  const result = ensureClusterWatchCron(stateDir, createEnv());
  const jobsPath = join(stateDir, 'cron', 'jobs.json');
  const jobs = JSON.parse(readFileSync(jobsPath, 'utf8'));

  assert.equal(result.changed, true);
  assert.equal(existsSync(jobsPath), true);
  assert.equal(jobs.some((job) => job.name === 'agnts-cluster-watch'), true);
});

test('bootstrapAgntsRuntime skips when AGNTS admin env is absent', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-workspace-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-state-'));
  const result = bootstrapAgntsRuntime({ stateDir, workspaceDir, env: {} });

  assert.equal(result.enabled, false);
  assert.equal(result.workspace.skipped, true);
  assert.equal(result.cron.skipped, true);
});

test('buildAgntsManagedBlock honors AGNTS_TOOLING_ROOT overrides', () => {
  const content = buildAgntsManagedBlock(createEnv({
    AGNTS_TOOLING_ROOT: '/custom/tools',
  }));

  assert.match(content, /node \/custom\/tools\/dist\/runClusterWatchReadiness\.js/);
  assert.match(content, /node \/custom\/tools\/dist\/runClusterDrilldown\.js/);
});

test('server startup seeds AGNTS bootstrap files before gateway configuration exists', async () => {
  const harness = await startServer(createEnv());

  try {
    const agntsPath = join(harness.stateDir, 'workspace', 'AGNTS.md');
    const agentsPath = join(harness.stateDir, 'workspace', 'AGENTS.md');
    const jobsPath = join(harness.stateDir, 'cron', 'jobs.json');

    await waitForFile(agntsPath);
    await waitForFile(agentsPath);
    await waitForFile(jobsPath);

    assert.equal(existsSync(agntsPath), true);
    assert.equal(existsSync(agentsPath), true);
    assert.equal(existsSync(jobsPath), true);
    assert.match(readFileSync(agntsPath, 'utf8'), /## AGNTS cluster triage/);
    assert.match(readFileSync(agentsPath, 'utf8'), /## AGNTS cluster triage/);
    assert.equal(
      JSON.parse(readFileSync(jobsPath, 'utf8')).some((job) => job.name === 'agnts-cluster-watch'),
      true,
    );
  } finally {
    harness.cleanup();
  }
});
