import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from './helpers/server-harness.js';
import {
  bootstrapAgntsRuntime,
  buildAgntsManagedBlock,
  ensureClusterWatchCron,
  ensureAgntsWorkspaceBootstrap,
  resolveClusterWatchCronOwnership,
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
    assert.match(content, /must execute the AGNTS cluster-watch workflow/);
    assert.match(content, /do not substitute intuition/);
    assert.match(content, /Use the direct `node \/app\/\.\.\.` form/);
    assert.doesNotMatch(content, /Run `cd \/app && node/);
    assert.doesNotMatch(content, /Cluster watch report command: `cd \/app && node/);
    assert.doesNotMatch(content, /Scheduled monitor command: `cd \/app && node/);
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

test('resolveClusterWatchCronOwnership defaults to bootstrap and honors repo opt-out', () => {
  assert.equal(resolveClusterWatchCronOwnership({}), 'bootstrap');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: '' }), 'bootstrap');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'bootstrap' }), 'bootstrap');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'repo' }), 'repo');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'REPO' }), 'repo');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: '  repo  ' }), 'repo');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'external' }), 'repo');
  assert.equal(resolveClusterWatchCronOwnership({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'none' }), 'repo');
});

test('ensureClusterWatchCron leaves jobs.json untouched when ownership is repo', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-state-'));
  const cronDir = join(stateDir, 'cron');
  const jobsPath = join(cronDir, 'jobs.json');
  const existing = JSON.stringify(
    {
      version: 1,
      jobs: [
        {
          id: 'externally-managed',
          name: 'agnts-cluster-watch',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 * * * *', tz: 'UTC' },
          payload: { kind: 'agentTurn', message: 'repo-managed prompt' },
          createdAtMs: 1,
        },
      ],
    },
    null,
    2,
  );
  // Pre-seed the file so we can detect writes.
  mkdirSync(cronDir, { recursive: true });
  writeFileSync(jobsPath, existing, { flag: 'wx' });

  const result = ensureClusterWatchCron(
    stateDir,
    createEnv({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'repo' }),
  );

  assert.equal(result.changed, false);
  assert.equal(result.skipped, true);
  assert.match(result.skipReason || '', /managed externally/);
  assert.equal(readFileSync(jobsPath, 'utf8'), existing);
});

test('bootstrapAgntsRuntime cron skip under repo ownership still seeds AGNTS.md workspace files', () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-state-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'openclaw-agnts-workspace-'));
  const result = bootstrapAgntsRuntime({
    stateDir,
    workspaceDir,
    env: createEnv({ AGNTS_MANAGE_CLUSTER_WATCH_CRON: 'repo' }),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.cron.skipped, true);
  assert.equal(result.workspace.skipped, false);
  assert.equal(existsSync(join(stateDir, 'cron', 'jobs.json')), false);
  assert.equal(existsSync(join(workspaceDir, 'AGNTS.md')), true);
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
  assert.doesNotMatch(content, /Run `cd \/app && node/);
  assert.doesNotMatch(content, /Cluster watch report command: `cd \/app && node/);
  assert.doesNotMatch(content, /Scheduled monitor command: `cd \/app && node/);
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
