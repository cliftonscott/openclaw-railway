import { agntsClusterHealthSnapshot, } from "./agntsAdminTools.js";
import { writeOperatorReport, } from "./agntsReportWriter.js";
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function asInteger(value) {
    const parsed = asNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
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
function nextSeverity(current, candidate) {
    return severityRank(candidate) > severityRank(current) ? candidate : current;
}
function roundTo(value, places = 3) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
}
function normalize(value, maxValue) {
    if (maxValue <= 0) {
        return 0;
    }
    return value / maxValue;
}
function labelAgent(agent) {
    return (asString(agent.handle) ??
        asString(agent.displayName) ??
        asString(agent.agentId) ??
        "unknown-agent");
}
function extractDivergenceDisabled(value) {
    return asString(asRecord(value).error) === "divergence_disabled";
}
function extractIndexRequired(value) {
    return asString(asRecord(value).error) === "index_required";
}
function buildBehavioralRanks(clusterSnapshot) {
    const data = asRecord(clusterSnapshot.data);
    const behavioral = asRecord(data.behavioral);
    const topDrift = asRecord(data.topDrift);
    const topDivergent = asRecord(data.topDivergent);
    const clusters = asArray(behavioral.clusters).map((value) => asRecord(value));
    const topDriftAgents = asArray(topDrift.agents).map((value) => asRecord(value));
    const topDivergentAgents = asArray(topDivergent.agents).map((value) => asRecord(value));
    const driftHitsByCluster = new Map();
    for (const agent of topDriftAgents) {
        const clusterId = asInteger(agent.clusterId);
        if (clusterId === null)
            continue;
        driftHitsByCluster.set(clusterId, (driftHitsByCluster.get(clusterId) ?? 0) + 1);
    }
    const divergentHitsByCluster = new Map();
    for (const agent of topDivergentAgents) {
        const clusterId = asInteger(agent.clusterId);
        if (clusterId === null)
            continue;
        divergentHitsByCluster.set(clusterId, (divergentHitsByCluster.get(clusterId) ?? 0) + 1);
    }
    const candidates = clusters.map((cluster) => {
        const clusterId = asInteger(cluster.clusterId) ?? -1;
        const agents = asArray(cluster.agents).map((value) => asRecord(value));
        const driftValues = agents
            .map((agent) => asNumber(agent.driftVelocity))
            .filter((value) => value !== null);
        const avgDriftVelocity = driftValues.length > 0
            ? driftValues.reduce((sum, value) => sum + value, 0) / driftValues.length
            : 0;
        return {
            avgCentroidDistance: asNumber(cluster.avgCentroidDistance) ?? 0,
            avgDriftVelocity,
            clusterId,
            divergentHits: divergentHitsByCluster.get(clusterId) ?? 0,
            driftHits: driftHitsByCluster.get(clusterId) ?? 0,
            leadAgents: agents.slice(0, 3).map(labelAgent),
            size: asInteger(cluster.size) ?? agents.length,
        };
    });
    const maxCentroid = Math.max(...candidates.map((item) => item.avgCentroidDistance), 0);
    const maxDrift = Math.max(...candidates.map((item) => item.avgDriftVelocity), 0);
    const maxDriftHits = Math.max(...candidates.map((item) => item.driftHits), 0);
    const maxDivergentHits = Math.max(...candidates.map((item) => item.divergentHits), 0);
    return candidates
        .map((item) => ({
        ...item,
        riskScore: roundTo(normalize(item.avgDriftVelocity, maxDrift) * 0.4 +
            normalize(item.avgCentroidDistance, maxCentroid) * 0.3 +
            normalize(item.driftHits, maxDriftHits) * 0.15 +
            normalize(item.divergentHits, maxDivergentHits) * 0.15),
    }))
        .sort((left, right) => right.riskScore - left.riskScore)
        .slice(0, 3);
}
function buildRelationshipRanks(clusterSnapshot) {
    const data = asRecord(clusterSnapshot.data);
    const relationship = asRecord(data.relationship);
    const topDrift = asRecord(data.topDrift);
    const topDivergent = asRecord(data.topDivergent);
    const behavioral = asRecord(data.behavioral);
    const relationshipClusters = asArray(relationship.clusters).map((value) => asRecord(value));
    const topDriftAgents = asArray(topDrift.agents).map((value) => asRecord(value));
    const topDivergentAgents = asArray(topDivergent.agents).map((value) => asRecord(value));
    const behavioralClusters = asArray(behavioral.clusters).map((value) => asRecord(value));
    const driftIds = new Set(topDriftAgents
        .map((agent) => asString(agent.agentId))
        .filter((agentId) => agentId !== null));
    const divergentIds = new Set(topDivergentAgents
        .map((agent) => asString(agent.agentId))
        .filter((agentId) => agentId !== null));
    const behavioralClusterByAgent = new Map();
    for (const cluster of behavioralClusters) {
        const clusterId = asInteger(cluster.clusterId);
        if (clusterId === null)
            continue;
        for (const member of asArray(cluster.agents).map((value) => asRecord(value))) {
            const agentId = asString(member.agentId);
            if (agentId) {
                behavioralClusterByAgent.set(agentId, clusterId);
            }
        }
    }
    const candidates = relationshipClusters.map((cluster) => {
        const agents = asArray(cluster.agents).map((value) => asRecord(value));
        const agentIds = agents
            .map((agent) => asString(agent.agentId))
            .filter((agentId) => agentId !== null);
        const overlapBehavioralClusters = Array.from(new Set(agentIds
            .map((agentId) => behavioralClusterByAgent.get(agentId))
            .filter((clusterId) => clusterId !== undefined))).sort((left, right) => left - right);
        return {
            clusterId: asInteger(cluster.clusterId) ?? -1,
            cohesion: asNumber(cluster.cohesion) ?? 0,
            divergentHits: agentIds.filter((agentId) => divergentIds.has(agentId)).length,
            driftHits: agentIds.filter((agentId) => driftIds.has(agentId)).length,
            leadAgents: agents.slice(0, 3).map(labelAgent),
            overlapBehavioralClusters,
            size: asInteger(cluster.size) ?? agents.length,
        };
    });
    const maxDriftHits = Math.max(...candidates.map((item) => item.driftHits), 0);
    const maxDivergentHits = Math.max(...candidates.map((item) => item.divergentHits), 0);
    const maxCohesion = Math.max(...candidates.map((item) => item.cohesion), 0);
    return candidates
        .map((item) => ({
        ...item,
        riskScore: roundTo(normalize(item.driftHits, maxDriftHits) * 0.45 +
            normalize(item.divergentHits, maxDivergentHits) * 0.45 +
            normalize(maxCohesion - item.cohesion, maxCohesion) * 0.1),
    }))
        .sort((left, right) => right.riskScore - left.riskScore)
        .slice(0, 3);
}
function transportEvidence(title, route, summary, transport) {
    return {
        requestId: asString(transport.requestId),
        route,
        source: "adminApi",
        summary,
        textHash: asString(transport.textHash),
        title,
    };
}
export function buildClusterDegradationReport(input) {
    const clusterSnapshotData = asRecord(input.clusterSnapshot.data);
    const behavioral = asRecord(clusterSnapshotData.behavioral);
    const relationship = asRecord(clusterSnapshotData.relationship);
    const divergencePopulation = asRecord(clusterSnapshotData.divergencePopulation);
    const divergenceTrend = asRecord(clusterSnapshotData.divergenceTrend);
    const topDrift = asRecord(clusterSnapshotData.topDrift);
    const topDivergent = asRecord(clusterSnapshotData.topDivergent);
    const transport = asRecord(clusterSnapshotData.transport);
    const divergenceDisabled = extractDivergenceDisabled(behavioral) ||
        extractDivergenceDisabled(divergencePopulation) ||
        extractDivergenceDisabled(topDrift) ||
        extractDivergenceDisabled(topDivergent);
    const partialIndexFailure = extractIndexRequired(behavioral) ||
        extractIndexRequired(topDrift) ||
        extractIndexRequired(topDivergent) ||
        extractIndexRequired(divergencePopulation) ||
        extractIndexRequired(divergenceTrend);
    const leadingBehavioralClusters = divergenceDisabled
        ? []
        : buildBehavioralRanks(input.clusterSnapshot);
    const leadingRelationshipClusters = buildRelationshipRanks(input.clusterSnapshot);
    const evidence = [
        transportEvidence("Behavioral clustering", "/_admin/observability/clustering/behavioral", divergenceDisabled
            ? "Behavioral clustering unavailable because divergence analytics are disabled."
            : `clusterCount=${String(asInteger(behavioral.clusterCount) ?? 0)}, silhouetteSampled=${String(asNumber(behavioral.silhouetteSampled) ?? "unknown")}`, asRecord(transport.behavioral)),
        transportEvidence("Relationship clustering", "/_admin/observability/clustering/relationship", `clusterCount=${String(asInteger(relationship.clusterCount) ?? 0)}, totalEdges=${String(asInteger(relationship.totalEdges) ?? 0)}`, asRecord(transport.relationship)),
        transportEvidence("Top drift agents", "/_admin/observability/divergence/agents/top-drift", divergenceDisabled
            ? "Top-drift ranking unavailable because divergence analytics are disabled."
            : `agents=${String(asArray(topDrift.agents).length)}`, asRecord(transport.topDrift)),
        transportEvidence("Top divergent agents", "/_admin/observability/divergence/agents/top-divergent", divergenceDisabled
            ? "Top-divergent ranking unavailable because divergence analytics are disabled."
            : `agents=${String(asArray(topDivergent.agents).length)}`, asRecord(transport.topDivergent)),
    ];
    const crossChecks = [
        "Cross-referenced behavioral clusters against top-drift and top-divergent agent lists.",
        "Used relationship clusters only as supporting evidence, not as the primary degradation score source.",
    ];
    const likelyCauses = [];
    const nextActions = [];
    const safeSuggestedActions = [];
    const unknowns = [];
    const affectedSystems = ["observability", "clustering", "divergence"];
    let severity = "healthy";
    let confidence = "high";
    let summary = "No cluster-level degradation signal stood out in the current snapshot.";
    if (divergenceDisabled) {
        severity = "unknown";
        confidence = "low";
        summary =
            "Behavioral cluster degradation cannot be confirmed because divergence analytics are disabled in the current runtime.";
        likelyCauses.push("obsDivergenceEnabled is off or the divergence endpoints are intentionally disabled.");
        nextActions.push("Enable divergence analytics if you need behavioral cluster degradation ranking.");
        if (leadingRelationshipClusters.length > 0) {
            nextActions.push("Use relationship clusters only as a social grouping reference until divergence data is restored.");
        }
    }
    else if (leadingBehavioralClusters.length > 0) {
        const topCluster = leadingBehavioralClusters[0];
        summary = `Behavioral cluster ${topCluster.clusterId} is degrading first in the current window, with riskScore=${topCluster.riskScore}, avgDriftVelocity=${roundTo(topCluster.avgDriftVelocity)}, and avgCentroidDistance=${roundTo(topCluster.avgCentroidDistance)}.`;
        if (topCluster.riskScore >= 0.4 ||
            topCluster.driftHits >= 3 ||
            topCluster.divergentHits >= 2) {
            severity = "warning";
        }
        if ((topCluster.riskScore >= 0.9 && topCluster.divergentHits >= 2) ||
            (topCluster.avgCentroidDistance >= 1.2 && topCluster.divergentHits >= 8)) {
            severity = "critical";
        }
        if (topCluster.riskScore < 0.35) {
            severity = "healthy";
        }
        likelyCauses.push(`Cluster ${topCluster.clusterId} combines elevated drift and centroid distance across ${topCluster.size} members.`);
        nextActions.push(`Inspect the agents in behavioral cluster ${topCluster.clusterId}: ${topCluster.leadAgents.join(", ")}.`);
        if (leadingRelationshipClusters.length > 0) {
            const socialLeader = leadingRelationshipClusters[0];
            nextActions.push(`Cross-check relationship cluster ${socialLeader.clusterId} for overlap pressure (${socialLeader.leadAgents.join(", ")}).`);
        }
        safeSuggestedActions.push({
            action: `Run a per-agent divergence drilldown for the leading behavioral cluster ${topCluster.clusterId}.`,
            rationale: "The cluster ranking is derived from the current top-drift/top-divergent lists and should be confirmed at the agent level before any intervention.",
            requiresApproval: false,
        });
    }
    else {
        confidence = "medium";
        unknowns.push("Behavioral cluster data was available, but no ranked cluster exceeded the current degradation threshold.");
    }
    if (!divergenceDisabled && partialIndexFailure) {
        confidence = "medium";
        unknowns.push("One or more divergence routes are missing required Firestore indexes, so this ranking is based on a partial snapshot.");
    }
    const silhouette = asNumber(behavioral.silhouetteSampled);
    if (silhouette !== null && silhouette < 0.2) {
        severity = nextSeverity(severity, "warning");
        likelyCauses.push(`Population clustering quality is weak (silhouetteSampled=${roundTo(silhouette)}), so cluster boundaries may be unstable.`);
    }
    const trendWindows = asArray(divergenceTrend.windows);
    if (!divergenceDisabled && trendWindows.length === 0) {
        confidence = "medium";
        unknowns.push("Divergence trend returned no windows, so the ranking is based on a single snapshot only.");
    }
    const snapshotRefs = input.clusterSnapshot.snapshotRef
        ? [input.clusterSnapshot.snapshotRef]
        : [];
    const report = {
        affectedSystems,
        confidence,
        crossChecks,
        evidence,
        generatedAt: new Date().toISOString(),
        likelyCauses,
        nextActions,
        recommendedCursorPrompt: "Explain which agent clusters are degrading first using the cluster-degradation report and name the strongest evidence routes.",
        recommendedShellCommands: [
            "cd openclaw-railway",
            "npm run report:cluster-degradation -- --stdout-only",
        ],
        safeSuggestedActions,
        schemaVersion: 1,
        severity,
        snapshotRefs,
        summary,
        title: input.title,
        type: "cluster-degradation-brief",
        unknowns,
    };
    return {
        leadingBehavioralClusters,
        leadingRelationshipClusters,
        report,
    };
}
export async function runClusterDegradationReport(options = {}) {
    const clusterSnapshot = await agntsClusterHealthSnapshot({
        ...options,
        persist: options.writeReport ?? true,
    });
    const built = buildClusterDegradationReport({
        clusterSnapshot,
        title: options.title ?? "AGNTS Cluster Degradation Report",
    });
    const writtenReport = options.writeReport === false
        ? null
        : await writeOperatorReport(built.report, { workspaceDir: options.workspaceDir });
    return {
        clusterSnapshot,
        leadingBehavioralClusters: built.leadingBehavioralClusters,
        leadingRelationshipClusters: built.leadingRelationshipClusters,
        report: built.report,
        writtenReport,
    };
}
//# sourceMappingURL=agntsClusterDegradation.js.map