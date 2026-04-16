import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..');
const defaultHealthUrl = process.env.OPENCLAW_HEALTH_URL || 'https://openclaw.agnts.social/health';
const defaultRailwayTarget = {
  project: process.env.AGNTS_RAILWAY_PROJECT || null,
  environment: process.env.AGNTS_RAILWAY_ENVIRONMENT || null,
  service: process.env.AGNTS_RAILWAY_SERVICE || null,
};
const trackedPaths = [
  'src/agnts-bootstrap.js',
  'src/gateway.js',
  'src/server.js',
  'src/config-sanitize.js',
];

const ansiPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, 'g');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs || 30000,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}) },
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = `${stdout}${stderr}`.trim();
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(combined || `${command} exited with code ${result.status}`);
  }
  return { stdout, stderr, combined, status: result.status ?? 1 };
}

function runRailway(args, options = {}) {
  return runCommand('railway', args, options);
}

function runGh(args, options = {}) {
  return runCommand('gh', args, options);
}

function buildRailwayStatusText(target) {
  if (!target.project && !target.environment && !target.service) {
    return runRailway(['status']).stdout.trim();
  }
  return [
    `Project: ${target.project || 'unknown'}`,
    `Environment: ${target.environment || 'unknown'}`,
    `Service: ${target.service || 'unknown'}`,
  ].join('\n');
}

function buildDeploymentListArgs(target) {
  const args = ['deployment', 'list', '--json', '--limit', '20'];
  if (target.service) {
    args.push('-s', target.service);
  }
  if (target.environment) {
    args.push('-e', target.environment);
  }
  return args;
}

function normalizeDeployments(rows) {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    timestamp: row.createdAt || row.timestamp || null,
  }));
}

function buildRemotePythonCommand(source) {
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `python3 -c "import base64; exec(base64.b64decode('${encoded}').decode())"`;
}

export function parseDeploymentList(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f-]{36}\s+\|/.test(line))
    .map((line) => {
      const [id, status, timestamp] = line.split('|').map((part) => part.trim());
      return { id, status, timestamp };
    });
}

export function extractTrailingJson(output) {
  const cleaned = output.replace(ansiPattern, '').trim();
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    return cleaned;
  }
  const newlineObjectStart = cleaned.lastIndexOf('\n{');
  if (newlineObjectStart >= 0) {
    return cleaned.slice(newlineObjectStart + 1).trim();
  }
  const objectStart = cleaned.lastIndexOf('{');
  if (objectStart >= 0) {
    return cleaned.slice(objectStart).trim();
  }
  throw new Error('No JSON document found in command output');
}

function getLocalCommit() {
  return runCommand('git', ['rev-parse', 'HEAD']).stdout.trim();
}

function getLocalHashes() {
  const hashes = {};
  for (const relativePath of trackedPaths) {
    const absolutePath = join(projectRoot, relativePath);
    hashes[relativePath] = existsSync(absolutePath)
      ? sha256(readFileSync(absolutePath))
      : null;
  }
  return hashes;
}

async function wakeService(healthUrl, timeoutMs = 15000) {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      ok: response.ok,
      status: response.status,
      url: healthUrl,
      body: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      url: healthUrl,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runRailwayWithRetry(args, options = {}) {
  const retries = options.retries ?? 6;
  const delayMs = options.delayMs ?? 3000;
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return runRailway(args, options);
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function getRemoteHashes() {
  const python = `
import hashlib, json, pathlib
paths = ${JSON.stringify(trackedPaths)}
result = {}
for relative in paths:
    path = pathlib.Path('/app') / relative
    if path.exists():
        result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    else:
        result[relative] = None
print(json.dumps(result))
`;
  const command = buildRemotePythonCommand(python);
  const result = await runRailwayWithRetry(['ssh', command], { timeoutMs: 30000 });
  return JSON.parse(result.stdout.trim());
}

async function getRemoteConfigState() {
  const python = `
import json, pathlib
path = pathlib.Path('/data/.openclaw/openclaw.json')
obj = json.loads(path.read_text())
entries = ((obj.get('plugins') or {}).get('entries') or {})
print(json.dumps({
  "memoryCoreEntry": entries.get('memory-core'),
  "pluginKeys": sorted(entries.keys()),
  "slackStreaming": (((obj.get('channels') or {}).get('slack') or {}).get('streaming')),
}))
`;
  const command = buildRemotePythonCommand(python);
  const result = await runRailwayWithRetry(['ssh', command], { timeoutMs: 30000 });
  return JSON.parse(result.stdout.trim());
}

async function runClusterQuestion() {
  const message = "Which agent clusters are degrading first? Include the exact live command paths you executed before the answer.";
  const command = `openclaw agent --agent main --message '${message}' --thinking low --verbose off --json`;
  const result = await runRailwayWithRetry(['ssh', command], {
    timeoutMs: 120000,
    retries: 3,
    delayMs: 5000,
  });
  const parsed = JSON.parse(extractTrailingJson(result.stdout));
  return parsed;
}

export function summarizeClusterVerification(payload) {
  const text = payload?.meta?.finalAssistantVisibleText || '';
  const toolSummary = payload?.meta?.toolSummary || {};
  const clusterMatch = text.match(/cluster\s+(\d+)/i);
  return {
    ok: text.includes('runClusterWatchReadiness.js') && text.includes('runClusterWatch.js'),
    clusterId: clusterMatch ? Number(clusterMatch[1]) : null,
    toolFailures: toolSummary.failures ?? null,
    toolCalls: toolSummary.calls ?? null,
    snippet: text.slice(0, 1200),
  };
}

function compareHashes(localHashes, remoteHashes) {
  const mismatches = [];
  for (const relativePath of trackedPaths) {
    if (localHashes[relativePath] !== remoteHashes[relativePath]) {
      mismatches.push(relativePath);
    }
  }
  return mismatches;
}

function buildRecommendedNextStep(state) {
  if (state.deployment.latest?.status !== 'SUCCESS') {
    return `Wait for Railway deployment ${state.deployment.latest?.id || 'unknown'} to leave ${state.deployment.latest?.status || 'unknown'} and rerun the verifier.`;
  }
  if (state.source.mode === 'ci') {
    return 'CI smoke verification passed. Use `npm run agnts:verify-deployment` locally for the full SSH-backed runtime audit.';
  }
  if (state.runtimeSource.mismatchedPaths.length > 0) {
    return `Resolve the source/runtime mismatch for ${state.runtimeSource.mismatchedPaths.join(', ')} and rerun the verifier.`;
  }
  if (state.runtimeConfig.memoryCoreEntry !== null) {
    return 'Scrub the remaining memory-core plugin drift from /data/.openclaw/openclaw.json and rerun the verifier.';
  }
  if (!state.clusterAnswer.ok || (state.clusterAnswer.toolFailures !== null && state.clusterAnswer.toolFailures !== 0)) {
    return 'Fix the live cluster-watch execution path for the main agent and rerun the verifier.';
  }
  return 'The runtime is healthy. The next step is to automate this verifier in your deploy workflow or CI dispatch.';
}

export async function verifyAgntsDeployment(options = {}) {
  const healthUrl = options.healthUrl || defaultHealthUrl;
  const mode = options.mode || process.env.AGNTS_VERIFY_MODE || 'full';
  const railwayTarget = {
    project: options.project || defaultRailwayTarget.project,
    environment: options.environment || defaultRailwayTarget.environment,
    service: options.service || defaultRailwayTarget.service,
  };
  const localCommit = getLocalCommit();
  const localHashes = getLocalHashes();
  const statusText = buildRailwayStatusText(railwayTarget);
  const deploymentsOutput = runRailway(buildDeploymentListArgs(railwayTarget), { timeoutMs: 30000 }).stdout;
  const deployments = normalizeDeployments(JSON.parse(deploymentsOutput));
  const health = await wakeService(healthUrl);
  const ciMode = mode === 'ci';

  const remoteHashes = ciMode
    ? Object.fromEntries(trackedPaths.map((path) => [path, null]))
    : await getRemoteHashes();
  const runtimeConfig = ciMode
    ? {
        memoryCoreEntry: 'skipped-in-ci',
        pluginKeys: [],
        slackStreaming: 'skipped-in-ci',
      }
    : await getRemoteConfigState();
  const clusterAnswer = ciMode
    ? {
        ok: true,
        clusterId: null,
        toolFailures: null,
        toolCalls: null,
        snippet: 'Skipped in CI mode because railway ssh is not reliable in GitHub-hosted runners.',
      }
    : summarizeClusterVerification(await runClusterQuestion());
  const mismatchedPaths = ciMode ? [] : compareHashes(localHashes, remoteHashes);

  const blockingIssues = [];
  if (deployments[0]?.status !== 'SUCCESS') {
    blockingIssues.push(`latest deployment ${deployments[0]?.id} is ${deployments[0]?.status}`);
  }
  if (!health.ok) {
    blockingIssues.push(`health endpoint ${healthUrl} is unavailable`);
  }
  if (!ciMode && mismatchedPaths.length > 0) {
    blockingIssues.push(`runtime source mismatch: ${mismatchedPaths.join(', ')}`);
  }
  if (!ciMode && runtimeConfig.memoryCoreEntry !== null) {
    blockingIssues.push('memory-core plugin drift still present in openclaw.json');
  }
  if (!ciMode && !clusterAnswer.ok) {
    blockingIssues.push('cluster answer did not use the live AGNTS cluster-watch path');
  }
  if (!ciMode && clusterAnswer.toolFailures !== null && clusterAnswer.toolFailures !== 0) {
    blockingIssues.push(`cluster answer had ${clusterAnswer.toolFailures} tool failures`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    service: {
      statusText,
      health,
    },
    deployment: {
      latest: deployments[0] || null,
      recent: deployments.slice(0, 5),
    },
    source: {
      localCommit,
      trackedPaths,
      mode,
      railwayTarget,
    },
    runtimeSource: {
      localHashes,
      remoteHashes,
      mismatchedPaths,
    },
    runtimeConfig,
    clusterAnswer,
    overall: {
      ok: blockingIssues.length === 0,
      blockingIssues,
      recommendedNextStep: '',
    },
  };
  result.overall.recommendedNextStep = buildRecommendedNextStep(result);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const modeArg = args.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1] : undefined;
  const result = await verifyAgntsDeployment({ mode });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.overall.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
