import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runClusterWatchReadinessCheck, } from "./agntsClusterWatchReadiness.js";
const DEFAULT_WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
function resolveWorkspaceDir(workspaceDir) {
    if (workspaceDir?.trim()) {
        return path.resolve(workspaceDir);
    }
    const configured = process.env.OPENCLAW_WORKSPACE_DIR?.trim();
    if (configured) {
        const resolved = path.resolve(configured);
        if (existsSync(resolved) || resolved.startsWith(process.cwd())) {
            return resolved;
        }
    }
    return DEFAULT_WORKSPACE_DIR;
}
function getMonitorStatePath(workspaceDir) {
    return path.join(resolveWorkspaceDir(workspaceDir), "openclaw", "state", "cluster-watch-monitor.json");
}
async function readMonitorState(workspaceDir) {
    const absolutePath = getMonitorStatePath(workspaceDir);
    try {
        const content = await readFile(absolutePath, "utf8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
async function writeMonitorState(state, workspaceDir) {
    const absolutePath = getMonitorStatePath(workspaceDir);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
}
function buildDigest(readiness) {
    const topCluster = readiness.watch.degradation.leadingBehavioralClusters[0] ?? null;
    const topAgents = readiness.watch.drilldown?.agentFocus
        .slice(0, 3)
        .map((agent) => agent.handle ?? agent.agentId)
        .join(", ") ?? "";
    if (!topCluster) {
        return readiness.watch.report.summary;
    }
    return [
        `Cluster watch alert: behavioral cluster ${topCluster.clusterId}.`,
        `Severity: ${readiness.watch.report.severity}.`,
        topAgents ? `Lead agents: ${topAgents}.` : null,
        readiness.watch.report.summary,
    ]
        .filter((value) => Boolean(value))
        .join(" ");
}
function shouldEmitClusterWatch(input) {
    if (input.severity === "warning" || input.severity === "critical") {
        return {
            reason: "severity is warning-or-higher",
            shouldEmit: true,
        };
    }
    if (input.previousState?.lastEmittedClusterId !== input.clusterId) {
        return {
            reason: "top behavioral cluster changed since the last emitted run",
            shouldEmit: true,
        };
    }
    return {
        reason: "cluster watch is healthy and unchanged since the last emitted run",
        shouldEmit: false,
    };
}
export async function runClusterWatchMonitor(options = {}) {
    const readiness = await runClusterWatchReadinessCheck({
        workspaceDir: options.workspaceDir,
        writeReport: options.writeReport ?? true,
    });
    if (!readiness.result.clusterWatchReady) {
        return {
            clusterId: readiness.result.leadingBehavioralClusterId,
            digest: null,
            emittedState: null,
            reason: readiness.result.blockingReason ?? "cluster watch is not ready",
            readiness: readiness.result,
            reportSummary: readiness.watch.report.summary,
            severity: readiness.watch.report.severity,
            shouldEmit: false,
        };
    }
    const previousState = await readMonitorState(options.workspaceDir);
    const clusterId = readiness.result.watchLeadingBehavioralClusterId;
    const severity = readiness.watch.report.severity;
    const emission = shouldEmitClusterWatch({
        clusterId,
        previousState,
        severity,
    });
    let emittedState = null;
    if (emission.shouldEmit) {
        emittedState = await writeMonitorState({
            lastEmittedAt: new Date().toISOString(),
            lastEmittedClusterId: clusterId,
            lastEmittedSeverity: severity,
        }, options.workspaceDir);
    }
    return {
        clusterId,
        digest: emission.shouldEmit ? buildDigest(readiness) : null,
        emittedState,
        reason: emission.reason,
        readiness: readiness.result,
        reportSummary: readiness.watch.report.summary,
        severity,
        shouldEmit: emission.shouldEmit,
    };
}
//# sourceMappingURL=agntsClusterWatchMonitor.js.map