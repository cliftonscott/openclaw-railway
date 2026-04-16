import { agntsAdminGet, OpenClawAdminApiError } from "./agntsAdminApi.js";
import { runClusterDegradationReport, } from "./agntsClusterDegradation.js";
import { runClusterWatch } from "./agntsClusterWatch.js";
function isAlertSeverity(value) {
    return value === "warning" || value === "critical";
}
function isIndexRelatedText(value) {
    const normalized = value.toLowerCase();
    return (normalized.includes("failed_precondition") ||
        normalized.includes("index") ||
        normalized.includes("partial snapshot") ||
        normalized.includes("currently building"));
}
function includesIndexRelatedUnknown(values) {
    return values.some((value) => isIndexRelatedText(value));
}
function buildRecommendedNextStep(input) {
    if (input.clusterWatchReady) {
        return "Cluster watch is ready. Sync the built tooling into OpenClaw-UI and enable the hosted cluster-watch path.";
    }
    if (!input.topDriftReady) {
        return "Keep cluster watch gated off in OpenClaw-UI until /_admin/observability/divergence/agents/top-drift returns 200 without an index-building error, then rerun this readiness command.";
    }
    if (input.blockingReason) {
        return "Keep the hosted cluster-watch rollout gated and rerun this readiness command after the blocking condition clears.";
    }
    return "Rerun the readiness command after the next deploy or runtime change to confirm the hosted cluster-watch path is stable.";
}
async function probeTopDriftRoute() {
    try {
        const response = await agntsAdminGet("/_admin/observability/divergence/agents/top-drift", {
            query: { limit: 20 },
        });
        return {
            blockingReason: null,
            requestId: response.requestId,
            status: response.status,
            topDriftReady: response.status === 200,
        };
    }
    catch (error) {
        if (error instanceof OpenClawAdminApiError) {
            return {
                blockingReason: isIndexRelatedText(error.bodyText)
                    ? "The top-drift divergence route is still blocked by a Firestore index build."
                    : `The top-drift divergence route failed: ${error.message}`,
                requestId: error.requestId,
                status: error.status,
                topDriftReady: false,
            };
        }
        return {
            blockingReason: error instanceof Error ? error.message : String(error),
            requestId: null,
            status: null,
            topDriftReady: false,
        };
    }
}
export async function runClusterWatchReadinessCheck(options = {}) {
    const topDriftProbe = await probeTopDriftRoute();
    const degradation = await runClusterDegradationReport({
        workspaceDir: options.workspaceDir,
        writeReport: false,
    });
    const watch = await runClusterWatch({
        workspaceDir: options.workspaceDir,
        writeReport: options.writeReport ?? false,
    });
    const degradationUnknowns = degradation.report.unknowns;
    const watchUnknowns = [
        ...watch.degradation.report.unknowns,
        ...watch.report.unknowns,
        ...(watch.drilldown?.report.unknowns ?? []),
    ];
    const leadingBehavioralClusterId = degradation.leadingBehavioralClusters[0]?.clusterId ?? null;
    const watchLeadingBehavioralClusterId = watch.degradation.leadingBehavioralClusters[0]?.clusterId ?? null;
    const drilldownAgentCount = watch.drilldown?.agentFocus.length ?? 0;
    let blockingReason = topDriftProbe.blockingReason;
    if (!blockingReason && includesIndexRelatedUnknown(degradationUnknowns)) {
        blockingReason =
            "Cluster degradation still reports an index-related partial snapshot, so cluster-watch should stay gated.";
    }
    if (!blockingReason && includesIndexRelatedUnknown(watchUnknowns)) {
        blockingReason =
            "Cluster watch still reports an index-related partial snapshot, so the hosted rollout should stay gated.";
    }
    if (!blockingReason &&
        leadingBehavioralClusterId !== null &&
        watchLeadingBehavioralClusterId !== null &&
        leadingBehavioralClusterId !== watchLeadingBehavioralClusterId) {
        blockingReason =
            `Cluster degradation points to behavioral cluster ${leadingBehavioralClusterId}, but cluster watch elevated ${watchLeadingBehavioralClusterId}.`;
    }
    if (!blockingReason &&
        isAlertSeverity(degradation.report.severity) &&
        !watch.triggered) {
        blockingReason =
            "Cluster degradation shows an alert-grade signal, but cluster watch did not trigger on the same snapshot.";
    }
    if (!blockingReason && watch.triggered && drilldownAgentCount === 0) {
        blockingReason =
            "Cluster watch triggered, but the follow-up drilldown returned no focus agents.";
    }
    const clusterWatchReady = blockingReason === null;
    return {
        degradation,
        result: {
            blockingReason,
            clusterWatchReady,
            degradationUnknowns,
            drilldownAgentCount,
            leadingBehavioralClusterId,
            recommendedNextStep: buildRecommendedNextStep({
                blockingReason,
                clusterWatchReady,
                topDriftReady: topDriftProbe.topDriftReady,
            }),
            topDriftReady: topDriftProbe.topDriftReady,
            topDriftRequestId: topDriftProbe.requestId,
            topDriftStatus: topDriftProbe.status,
            triggered: watch.triggered,
            watchLeadingBehavioralClusterId,
            watchUnknowns,
        },
        watch,
    };
}
export async function runClusterWatchReadiness(options = {}) {
    const readiness = await runClusterWatchReadinessCheck(options);
    return readiness.result;
}
//# sourceMappingURL=agntsClusterWatchReadiness.js.map