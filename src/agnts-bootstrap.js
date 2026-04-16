import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOOLING_ROOT = resolve(__dirname, '..', 'agnts-tooling');
const DEFAULT_CLUSTER_WATCH_SCHEDULE = '0 * * * *';
const DEFAULT_CLUSTER_WATCH_CHANNEL = '#openclaw';
const DEFAULT_CLUSTER_WATCH_AGENT_ID = 'main';
const AGNTS_MANAGED_START = '<!-- AGNTS_BOOTSTRAP_START -->';
const AGNTS_MANAGED_END = '<!-- AGNTS_BOOTSTRAP_END -->';

function trimEnv(env, key) {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoolean(value, fallback) {
  if (value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return fallback;
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkdownSection(content, heading) {
  const pattern = new RegExp(`(^|\\n)## ${escapeRegExp(heading)}\\n[\\s\\S]*?(?=\\n## |$)`, 'g');
  return content.replace(pattern, '\n').trimEnd();
}

function removeManagedBlock(content) {
  const startIndex = content.indexOf(AGNTS_MANAGED_START);
  const endIndex = content.indexOf(AGNTS_MANAGED_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return content;
  }
  const afterEnd = endIndex + AGNTS_MANAGED_END.length;
  return `${content.slice(0, startIndex).trimEnd()}\n`;
}

export function isAgntsBootstrapEnabled(env = process.env) {
  const explicitlyEnabled = parseBoolean(trimEnv(env, 'AGNTS_BOOTSTRAP_ENABLED'), false);
  if (explicitlyEnabled) {
    return true;
  }

  return trimEnv(env, 'AGNTS_ADMIN_CLIENT_ID') !== '' &&
    trimEnv(env, 'AGNTS_ADMIN_CLIENT_SECRET') !== '';
}

export function getAgntsToolingRoot(env = process.env) {
  const configured = trimEnv(env, 'AGNTS_TOOLING_ROOT');
  return configured || DEFAULT_TOOLING_ROOT;
}

export function buildAgntsManagedBlock(env = process.env) {
  const toolingRoot = getAgntsToolingRoot(env);
  const readinessCommand = `node ${toolingRoot}/dist/runClusterWatchReadiness.js --stdout-only`;
  const watchCommand = `node ${toolingRoot}/dist/runClusterWatch.js --stdout-only`;
  const monitorCommand = `node ${toolingRoot}/dist/runClusterWatchMonitor.js --stdout-only`;
  const drilldownCommand = `node ${toolingRoot}/dist/runClusterDrilldown.js --cluster-id <clusterId> --stdout-only`;
  const degradationCommand = `node ${toolingRoot}/dist/runClusterDegradation.js --stdout-only`;

  return ensureTrailingNewline([
    AGNTS_MANAGED_START,
    '## AGNTS admin API auth',
    '',
    'For AGNTS admin operations, authenticate as the external service `openclaw`.',
    'Use `AGNTS_ADMIN_CLIENT_ID` and `AGNTS_ADMIN_CLIENT_SECRET` to mint a short-lived OIDC `access_token` from `https://developers.agnts.social/oidc/token` with `grant_type=client_credentials` and `service_id=openclaw`.',
    'Use `openid admin.read` for read-only calls and `openid admin.read admin.write` only for mutating calls.',
    'Call the AGNTS admin API at `https://us-central1-drift-55edb.cloudfunctions.net/adminApi` with `Authorization: Bearer <access_token>`.',
    'Use the `access_token`, not the `id_token`. Re-mint when expired or after a 401.',
    '',
    '## AGNTS bundled skills',
    '',
    'Prefer the bundled AGNTS operator skills when they match the task.',
    'Primary skills:',
    '- `agnts_cluster_watch`',
    '- `agnts_cluster_triage`',
    '- `agnts_runtime_auditor`',
    '- `agnts_observability_scout`',
    '- `agnts_scheduler_forensics`',
    '- `agnts_rollout_guardian`',
    '- `agnts_moderation_watch`',
    '- `agnts_guarded_runtime_toggle`',
    '- `agnts_plan_auditor`',
    'If a bundled skill is available for the task, use it before narrating raw admin routes by hand.',
    'If a bundled skill does not actually execute the needed live AGNTS checks, immediately fall back to the direct report commands instead of answering from intuition.',
    'If a bundled skill is unavailable or blocked, fall back to the AGNTS report commands below.',
    '',
    '## AGNTS cluster triage',
    '',
    'When asked which agent clusters are degrading first, you must execute the AGNTS cluster-watch workflow in this turn if the report commands are available.',
    'Do not answer from heuristics, priors, or best guesses when live command execution is possible.',
    'Use this order:',
    '1. Prefer the bundled `agnts_cluster_watch` skill when available.',
    '2. If the bundled skill does not return a concrete live result, use the `exec` tool and run the readiness and report commands directly in the same turn.',
    '   Use the direct `node /app/...` form, not compound shell wrappers such as `cd /app && node ...`.',
    `3. Run \`${readinessCommand}\` and read the JSON result.`,
    '4. If `clusterWatchReady` is `true`, run the cluster watch report.',
    `5. If the watch triggers, run \`${drilldownCommand}\` with the reported behavioral cluster id.`,
    `6. Fall back to \`${degradationCommand}\` only for explicit ranking-only needs or if the readiness gate says cluster watch is blocked.`,
    '',
    `Cluster watch report command: \`${watchCommand}\``,
    `Scheduled monitor command: \`${monitorCommand}\``,
    '',
    'Rules:',
    '- State which command path you executed before giving the answer.',
    '- Behavioral clusters are the primary answer.',
    '- Relationship clusters are supporting evidence only.',
    '- If `top-drift` is still partial or index-blocked, say so explicitly.',
    '- If the watch does not trigger, say there is no alert-grade degrading cluster in the current snapshot.',
    '- If the watch does trigger, cite the selected behavioral cluster and the focus agents from drilldown.',
    '- If command execution fails or is blocked, say that explicitly and name the failing command; do not substitute intuition.',
    AGNTS_MANAGED_END,
    '',
  ].join('\n'));
}

export function upsertAgntsWorkspaceContent(content, env = process.env, options = {}) {
  const defaultHeading = options.defaultHeading || '# AGNTS';
  const withoutManagedBlock = removeManagedBlock(content);
  const withoutLegacySections = stripMarkdownSection(
    stripMarkdownSection(
      stripMarkdownSection(withoutManagedBlock, 'AGNTS cluster triage'),
      'AGNTS bundled skills',
    ),
    'AGNTS admin API auth',
  ).trimEnd();

  const prefix = withoutLegacySections.length > 0
    ? ensureTrailingNewline(withoutLegacySections)
    : `${defaultHeading}\n\n`;

  return ensureTrailingNewline(`${prefix.trimEnd()}\n\n${buildAgntsManagedBlock(env).trimEnd()}\n`);
}

function ensureAgntsWorkspaceFile(workspaceDir, filename, env, options = {}) {
  const defaultHeading = options.defaultHeading || '# AGNTS';
  const filePath = join(workspaceDir, filename);
  const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const next = upsertAgntsWorkspaceContent(current, env, { defaultHeading });

  if (next !== current) {
    writeFileSync(filePath, next, 'utf8');
    return { changed: true, path: filePath, skipped: false, filename };
  }

  return { changed: false, path: filePath, skipped: false, filename };
}

export function ensureAgntsWorkspaceBootstrap(workspaceDir, env = process.env) {
  if (!isAgntsBootstrapEnabled(env)) {
    const targets = [
      { changed: false, path: join(workspaceDir, 'AGNTS.md'), skipped: true, filename: 'AGNTS.md' },
      { changed: false, path: join(workspaceDir, 'AGENTS.md'), skipped: true, filename: 'AGENTS.md' },
    ];
    return { changed: false, path: targets[0].path, skipped: true, targets };
  }

  mkdirSync(workspaceDir, { recursive: true });
  const targets = [
    ensureAgntsWorkspaceFile(workspaceDir, 'AGNTS.md', env, { defaultHeading: '# AGNTS' }),
    ensureAgntsWorkspaceFile(workspaceDir, 'AGENTS.md', env, { defaultHeading: '# AGENTS.md' }),
  ];

  return {
    changed: targets.some((target) => target.changed),
    path: (targets.find((target) => target.changed) || targets[0]).path,
    skipped: false,
    targets,
  };
}

function buildClusterWatchJob(env = process.env) {
  const toolingRoot = getAgntsToolingRoot(env);
  const monitorCommand = `node ${toolingRoot}/dist/runClusterWatchMonitor.js --stdout-only`;
  const jobName = trimEnv(env, 'AGNTS_CLUSTER_WATCH_JOB_NAME') || 'agnts-cluster-watch';
  const destination = trimEnv(env, 'AGNTS_CLUSTER_WATCH_CHANNEL') || DEFAULT_CLUSTER_WATCH_CHANNEL;

  return {
    name: jobName,
    agentId: trimEnv(env, 'AGNTS_CLUSTER_WATCH_AGENT_ID') || DEFAULT_CLUSTER_WATCH_AGENT_ID,
    enabled: parseBoolean(trimEnv(env, 'AGNTS_CLUSTER_WATCH_CRON_ENABLED'), true),
    deleteAfterRun: true,
    schedule: {
      kind: 'cron',
      expr: trimEnv(env, 'AGNTS_CLUSTER_WATCH_SCHEDULE') || DEFAULT_CLUSTER_WATCH_SCHEDULE,
      tz: trimEnv(env, 'AGNTS_CLUSTER_WATCH_TIMEZONE') || 'UTC',
    },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: {
      kind: 'agentTurn',
      message: [
        'Run the AGNTS cluster watch monitor command and parse its JSON output.',
        `Command: \`${monitorCommand}\``,
        '',
        'If `shouldEmit` is `false`, do not produce user-facing output.',
        'If `shouldEmit` is `true`, announce a compact alert with:',
        '- the behavioral cluster id',
        '- the severity',
        '- the lead agents',
        '- the digest text',
      ].join('\n'),
    },
    delivery: {
      mode: 'announce',
      channel: 'slack',
      to: destination,
      bestEffort: false,
    },
  };
}

function normalizeJobsDocument(parsed) {
  if (Array.isArray(parsed)) {
    return {
      jobs: parsed,
      serialize: (jobs) => jobs,
    };
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.jobs)) {
    return {
      jobs: parsed.jobs,
      serialize: (jobs) => ({ ...parsed, jobs }),
    };
  }

  return {
    jobs: [],
    serialize: (jobs) => jobs,
  };
}

export function upsertClusterWatchJobsContent(content, env = process.env) {
  const parsed = content.trim().length > 0 ? JSON.parse(content) : [];
  const normalized = normalizeJobsDocument(parsed);
  const nextJob = buildClusterWatchJob(env);
  const jobs = normalized.jobs.filter((job) => job?.name !== nextJob.name);
  jobs.push(nextJob);
  return `${JSON.stringify(normalized.serialize(jobs), null, 2)}\n`;
}

export function ensureClusterWatchCron(stateDir, env = process.env) {
  if (!isAgntsBootstrapEnabled(env)) {
    return { changed: false, path: join(stateDir, 'cron', 'jobs.json'), skipped: true };
  }

  const cronDir = join(stateDir, 'cron');
  mkdirSync(cronDir, { recursive: true });
  const jobsPath = join(cronDir, 'jobs.json');
  const current = existsSync(jobsPath) ? readFileSync(jobsPath, 'utf8') : '[]\n';
  const next = upsertClusterWatchJobsContent(current, env);

  if (next !== current) {
    writeFileSync(jobsPath, next, 'utf8');
    return { changed: true, path: jobsPath, skipped: false };
  }

  return { changed: false, path: jobsPath, skipped: false };
}

export function bootstrapAgntsRuntime({ stateDir, workspaceDir, env = process.env }) {
  if (!isAgntsBootstrapEnabled(env)) {
    return {
      enabled: false,
      cron: { changed: false, path: join(stateDir, 'cron', 'jobs.json'), skipped: true },
      workspace: { changed: false, path: join(workspaceDir, 'AGNTS.md'), skipped: true },
    };
  }

  return {
    enabled: true,
    cron: ensureClusterWatchCron(stateDir, env),
    workspace: ensureAgntsWorkspaceBootstrap(workspaceDir, env),
  };
}
