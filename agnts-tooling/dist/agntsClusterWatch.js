import { buildClusterDegradationReport, } from "./agntsClusterDegradation.js";
import { runClusterDrilldownReport, summarizeClusterWatchTrigger, } from "./agntsClusterDrilldown.js";
import { agntsClusterHealthSnapshot, } from "./agntsAdminTools.js";
import { writeOperatorReport, } from "./agntsReportWriter.js";
function dedupe(values) {
    return [...new Set(values)];
}
function severityRank(value) {
    switch (value) {
        case "critical":
            return 3;
        case "warning":
            return 2;
        case "unknown":
            return 1;
        case "healthy":
        default:
            return 0;
    }
}
function highestSeverity(values) {
    return values.reduce((current, candidate) => {
        return severityRank(candidate) > severityRank(current) ? candidate : current;
    }, "healthy");
}
function mergeConfidence(values) {
    if (values.includes("low")) {
        return "low";
    }
    if (values.includes("medium")) {
        return "medium";
    }
    return "high";
}
function mergeActions(lists) {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
        for (const item of list) {
            const key = `${item.action}::${item.rationale}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
        }
    }
    return merged;
}
function mergeEvidence(lists) {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
        for (const item of list) {
            const key = `${item.title}::${item.route ?? ""}::${item.summary}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(item);
        }
    }
    return merged;
}
function mergeSnapshotRefs(lists) {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
        for (const item of list) {
            if (seen.has(item.snapshotId)) {
                continue;
            }
            seen.add(item.snapshotId);
            merged.push(item);
        }
    }
    return merged;
}
export function buildClusterWatchReport(input) {
    const topCluster = input.degradation.leadingBehavioralClusters[0] ?? null;
    const summary = input.triggered && topCluster && input.drilldown
        ? `Cluster watch triggered on behavioral cluster ${topCluster.clusterId}. The current focus agents are ${input.drilldown.agentFocus
            .slice(0, 3)
            .map((agent) => agent.handle ?? agent.agentId)
            .join(", ")}.`
        : input.degradation.report.summary;
    const likelyCauses = dedupe([
        ...input.degradation.report.likelyCauses,
        ...(input.drilldown?.report.likelyCauses ?? []),
    ]);
    const nextActions = dedupe([
        ...input.degradation.report.nextActions,
        ...(input.drilldown?.report.nextActions ?? []),
    ]);
    const unknowns = dedupe([
        ...input.degradation.report.unknowns,
        ...(input.drilldown?.report.unknowns ?? []),
    ]);
    return {
        affectedSystems: dedupe([
            ...input.degradation.report.affectedSystems,
            ...(input.drilldown?.report.affectedSystems ?? []),
            "scheduled-monitor",
        ]),
        confidence: mergeConfidence([
            input.degradation.report.confidence,
            ...(input.drilldown ? [input.drilldown.report.confidence] : []),
        ]),
        crossChecks: dedupe([
            ...input.degradation.report.crossChecks,
            ...(input.drilldown?.report.crossChecks ?? []),
            "Escalated from cluster ranking to bounded per-agent drilldown only when the watch threshold was met.",
        ]),
        evidence: mergeEvidence([
            input.degradation.report.evidence,
            ...(input.drilldown ? [input.drilldown.report.evidence] : []),
        ]),
        generatedAt: new Date().toISOString(),
        likelyCauses,
        nextActions,
        recommendedCursorPrompt: input.triggered && topCluster
            ? `Summarize the current cluster watch alert for behavioral cluster ${topCluster.clusterId} and explain why those agents were selected for drilldown.`
            : "Summarize the current cluster watch result and say whether any cluster alert is active.",
        recommendedShellCommands: [
            "cd openclaw-railway",
            "npm run report:cluster-watch -- --stdout-only",
            ...(topCluster
                ? [`npm run report:cluster-drilldown -- --cluster-id ${topCluster.clusterId} --stdout-only`]
                : []),
        ],
        safeSuggestedActions: mergeActions([
            input.degradation.report.safeSuggestedActions,
            ...(input.drilldown ? [input.drilldown.report.safeSuggestedActions] : []),
        ]),
        schemaVersion: 1,
        severity: highestSeverity([
            input.degradation.report.severity,
            ...(input.drilldown ? [input.drilldown.report.severity] : []),
        ]),
        snapshotRefs: mergeSnapshotRefs([
            input.degradation.report.snapshotRefs,
            ...(input.drilldown ? [input.drilldown.report.snapshotRefs] : []),
        ]),
        summary,
        title: input.title,
        type: "anomaly-digest",
        unknowns,
    };
}
export async function runClusterWatch(options = {}) {
    const clusterSnapshot = await agntsClusterHealthSnapshot({
        ...options,
        persist: options.writeReport ?? true,
    });
    const degradationBuilt = buildClusterDegradationReport({
        clusterSnapshot,
        title: "AGNTS Cluster Degradation Report",
    });
    const degradation = {
        clusterSnapshot,
        leadingBehavioralClusters: degradationBuilt.leadingBehavioralClusters,
        leadingRelationshipClusters: degradationBuilt.leadingRelationshipClusters,
        report: degradationBuilt.report,
        writtenReport: null,
    };
    const trigger = summarizeClusterWatchTrigger(degradation);
    const drilldown = trigger.triggered && trigger.clusterId !== null
        ? await runClusterDrilldownReport({
            ...options,
            clusterId: trigger.clusterId,
            clusterSnapshot,
            title: `AGNTS Cluster ${trigger.clusterId} Drilldown`,
            writeReport: false,
        })
        : null;
    const report = buildClusterWatchReport({
        degradation,
        drilldown,
        title: options.title ?? "AGNTS Cluster Watch",
        triggered: trigger.triggered,
    });
    const writtenReport = options.writeReport === false
        ? null
        : await writeOperatorReport(report, { workspaceDir: options.workspaceDir });
    return {
        degradation,
        drilldown,
        report,
        triggered: trigger.triggered,
        writtenReport,
    };
}
//# sourceMappingURL=agntsClusterWatch.js.map