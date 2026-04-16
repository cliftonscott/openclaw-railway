import { agntsAdminGet, OpenClawAdminApiError, } from "./agntsAdminApi.js";
import { agntsClusterHealthSnapshot, } from "./agntsAdminTools.js";
import { writeOperatorReport, } from "./agntsReportWriter.js";
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function asString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function asInteger(value) {
    const parsed = asNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
}
function clamp(value, minValue, maxValue) {
    return Math.min(maxValue, Math.max(minValue, value));
}
function roundTo(value, places = 3) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
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
function labelAgent(agent) {
    return (asString(agent.handle) ??
        asString(agent.displayName) ??
        asString(agent.agentId) ??
        "unknown-agent");
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
function extractDivergenceDisabled(value) {
    return asString(asRecord(value).error) === "divergence_disabled";
}
function extractIndexRequired(value) {
    return asString(asRecord(value).error) === "index_required";
}
function extractWindowId(clusterSnapshot) {
    const data = asRecord(clusterSnapshot.data);
    return (asString(asRecord(data.behavioral).windowId) ??
        asString(asRecord(data.topDivergent).windowId) ??
        asString(asRecord(data.topDrift).windowId) ??
        asString(asRecord(data.divergencePopulation).windowId) ??
        null);
}
function readBehavioralClusterSample(clusterSnapshot, clusterId) {
    const behavioral = asRecord(asRecord(clusterSnapshot.data).behavioral);
    const cluster = asArray(behavioral.clusters)
        .map((value) => asRecord(value))
        .find((value) => asInteger(value.clusterId) === clusterId);
    if (!cluster) {
        throw new Error(`Behavioral cluster ${clusterId} was not found in the current cluster snapshot`);
    }
    const members = asArray(cluster.agents).map((value) => {
        const agent = asRecord(value);
        return {
            agentId: asString(agent.agentId) ?? "unknown-agent",
            avatarSeed: asString(agent.avatarSeed),
            centroidDistance: asNumber(agent.centroidDistance) ?? 0,
            clusterId,
            displayName: asString(agent.displayName),
            driftVelocity: asNumber(agent.driftVelocity) ?? 0,
            handle: asString(agent.handle),
        };
    });
    return {
        avgCentroidDistance: asNumber(cluster.avgCentroidDistance) ?? 0,
        members,
        sampledCount: members.length,
        size: asInteger(cluster.size) ?? members.length,
    };
}
function readClusterTopListMembers(source, clusterId) {
    return asArray(asRecord(source).agents)
        .map((value) => asRecord(value))
        .filter((agent) => asInteger(agent.clusterId) === clusterId)
        .map((agent) => ({
        agentId: asString(agent.agentId) ?? "unknown-agent",
        avatarSeed: asString(agent.avatarSeed),
        centroidDistance: asNumber(agent.centroidDistance) ?? 0,
        clusterId: asInteger(agent.clusterId),
        displayName: asString(agent.displayName),
        driftVelocity: asNumber(agent.driftVelocity) ?? 0,
        handle: asString(agent.handle),
    }));
}
function mergeAgentRecords(groups) {
    const merged = new Map();
    for (const group of groups) {
        for (const agent of group) {
            const existing = merged.get(agent.agentId);
            if (!existing) {
                merged.set(agent.agentId, agent);
                continue;
            }
            merged.set(agent.agentId, {
                agentId: agent.agentId,
                avatarSeed: existing.avatarSeed ?? agent.avatarSeed,
                centroidDistance: Math.max(existing.centroidDistance, agent.centroidDistance),
                clusterId: existing.clusterId ?? agent.clusterId,
                displayName: existing.displayName ?? agent.displayName,
                driftVelocity: Math.max(existing.driftVelocity, agent.driftVelocity),
                handle: existing.handle ?? agent.handle,
            });
        }
    }
    return [...merged.values()];
}
function computeCandidateScore(agent, topDriftIds, topDivergentIds) {
    return (clamp(agent.centroidDistance / 2, 0, 1) * 0.55 +
        clamp(agent.driftVelocity, 0, 1) * 0.3 +
        (topDivergentIds.has(agent.agentId) ? 0.1 : 0) +
        (topDriftIds.has(agent.agentId) ? 0.05 : 0));
}
function buildRelationshipOverlaps(clusterSnapshot, clusterAgentIds) {
    const relationship = asRecord(asRecord(clusterSnapshot.data).relationship);
    return asArray(relationship.clusters)
        .map((value) => asRecord(value))
        .map((cluster) => {
        const members = asArray(cluster.agents).map((value) => asRecord(value));
        const overlap = members
            .filter((member) => {
            const agentId = asString(member.agentId);
            return agentId !== null && clusterAgentIds.has(agentId);
        })
            .map(labelAgent);
        return {
            clusterId: asInteger(cluster.clusterId) ?? -1,
            overlapCount: overlap.length,
            overlapHandles: overlap.slice(0, 4),
            size: asInteger(cluster.size) ?? members.length,
        };
    })
        .filter((cluster) => cluster.overlapCount > 0)
        .sort((left, right) => right.overlapCount - left.overlapCount)
        .slice(0, 3);
}
async function fetchAgentDetailCaptures(agentIds, budget, windowId) {
    return Promise.all(agentIds.map(async (agentId) => {
        try {
            const response = await agntsAdminGet(`/_admin/observability/divergence/agent/${encodeURIComponent(agentId)}`, {
                budget,
                query: windowId ? { windowId } : undefined,
            });
            return {
                agentId,
                data: response.data ?? {},
                transport: {
                    durationMs: response.durationMs,
                    requestId: response.requestId,
                    status: response.status,
                    textHash: response.textHash,
                },
            };
        }
        catch (error) {
            if (error instanceof OpenClawAdminApiError && error.status === 404) {
                return {
                    agentId,
                    data: null,
                    transport: {
                        durationMs: error.durationMs,
                        error: error.bodyText,
                        requestId: error.requestId,
                        status: error.status,
                    },
                };
            }
            throw error;
        }
    }));
}
export function buildClusterDrilldownReport(input) {
    const clusterSnapshotData = asRecord(input.clusterSnapshot.data);
    const behavioral = asRecord(clusterSnapshotData.behavioral);
    const topDrift = asRecord(clusterSnapshotData.topDrift);
    const topDivergent = asRecord(clusterSnapshotData.topDivergent);
    const transport = asRecord(clusterSnapshotData.transport);
    const windowId = extractWindowId(input.clusterSnapshot);
    const divergenceDisabled = extractDivergenceDisabled(behavioral);
    const partialIndexFailure = extractIndexRequired(topDrift) || extractIndexRequired(topDivergent);
    if (divergenceDisabled) {
        throw new Error("Behavioral cluster drilldown is unavailable because divergence analytics are disabled");
    }
    const behavioralCluster = readBehavioralClusterSample(input.clusterSnapshot, input.clusterId);
    const clusterMembers = behavioralCluster.members;
    const topDriftAgents = readClusterTopListMembers(topDrift, input.clusterId);
    const topDivergentAgents = readClusterTopListMembers(topDivergent, input.clusterId);
    const clusterAgentIds = new Set(clusterMembers.map((member) => member.agentId));
    const topDriftIds = new Set(topDriftAgents.map((agent) => agent.agentId));
    const topDivergentIds = new Set(topDivergentAgents.map((agent) => agent.agentId));
    const detailByAgentId = new Map(input.agentDetailCaptures.map((capture) => [capture.agentId, capture]));
    const enrichedAgents = mergeAgentRecords([topDivergentAgents, topDriftAgents, clusterMembers]).map((member) => {
        const detail = detailByAgentId.get(member.agentId);
        const detailData = detail?.data ? asRecord(detail.data) : {};
        return {
            agentId: member.agentId,
            avatarSeed: member.avatarSeed,
            centroidDistance: asNumber(detailData.centroidDistance) ?? member.centroidDistance,
            detailAvailable: detail?.data !== null && detail !== undefined,
            displayName: asString(detailData.displayName) ?? member.displayName,
            driftVelocity: asNumber(detailData.driftVelocity) ?? member.driftVelocity,
            handle: asString(detailData.handle) ?? member.handle,
            inTopDivergent: topDivergentIds.has(member.agentId),
            inTopDrift: topDriftIds.has(member.agentId),
        };
    });
    const maxCentroidDistance = Math.max(...enrichedAgents.map((agent) => agent.centroidDistance), 0);
    const maxDriftVelocity = Math.max(...enrichedAgents.map((agent) => agent.driftVelocity), 0);
    const agentFocus = enrichedAgents
        .map((agent) => ({
        ...agent,
        focusScore: roundTo((maxCentroidDistance > 0 ? agent.centroidDistance / maxCentroidDistance : 0) * 0.5 +
            (maxDriftVelocity > 0 ? agent.driftVelocity / maxDriftVelocity : 0) * 0.3 +
            (agent.inTopDivergent ? 0.15 : 0) +
            (agent.inTopDrift ? 0.05 : 0)),
    }))
        .sort((left, right) => right.focusScore - left.focusScore);
    const avgCentroidDistance = behavioralCluster.avgCentroidDistance;
    const driftHits = topDriftAgents.length;
    const divergentHits = topDivergentAgents.length;
    const pressureScore = roundTo(clamp(avgCentroidDistance / 2, 0, 1) * 0.45 +
        clamp(enrichedAgents.reduce((sum, agent) => sum + agent.driftVelocity, 0) /
            Math.max(1, enrichedAgents.length), 0, 1) *
            0.35 +
        clamp(divergentHits / 5, 0, 1) * 0.2);
    const relationshipOverlaps = buildRelationshipOverlaps(input.clusterSnapshot, clusterAgentIds);
    const focusCluster = {
        avgCentroidDistance: roundTo(avgCentroidDistance),
        clusterId: input.clusterId,
        divergentHits,
        driftHits,
        memberCount: behavioralCluster.size,
        pressureScore,
        silhouetteSampled: asNumber(behavioral.silhouetteSampled),
        windowId,
    };
    const evidence = [
        transportEvidence("Behavioral clustering", "/_admin/observability/clustering/behavioral", `clusterId=${input.clusterId}, memberCount=${behavioralCluster.size}, sampledMembers=${behavioralCluster.sampledCount}, avgCentroidDistance=${focusCluster.avgCentroidDistance}`, asRecord(transport.behavioral)),
        transportEvidence("Top divergent agents", "/_admin/observability/divergence/agents/top-divergent", `clusterHits=${divergentHits}, totalListed=${asArray(topDivergent.agents).length}`, asRecord(transport.topDivergent)),
        transportEvidence("Top drift agents", "/_admin/observability/divergence/agents/top-drift", partialIndexFailure
            ? "Top-drift ranking unavailable because the Firestore composite index is missing."
            : `clusterHits=${driftHits}, totalListed=${asArray(topDrift.agents).length}`, asRecord(transport.topDrift)),
    ];
    for (const capture of input.agentDetailCaptures.slice(0, 3)) {
        const detail = capture.data ? asRecord(capture.data) : {};
        evidence.push({
            requestId: capture.transport.requestId,
            route: `/_admin/observability/divergence/agent/${capture.agentId}`,
            source: "adminApi",
            summary: capture.data === null
                ? "agent detail missing for the selected window"
                : `centroidDistance=${String(asNumber(detail.centroidDistance) ?? "unknown")}, driftVelocity=${String(asNumber(detail.driftVelocity) ?? "unknown")}, clusterId=${String(asInteger(detail.clusterId) ?? "unknown")}`,
            textHash: capture.transport.textHash,
            title: `Agent detail ${capture.agentId}`,
        });
    }
    let severity = "healthy";
    let confidence = "high";
    const likelyCauses = [];
    const nextActions = [];
    const safeSuggestedActions = [];
    const unknowns = [];
    if ((focusCluster.avgCentroidDistance >= 1.2 && focusCluster.divergentHits >= 3) ||
        (agentFocus[0]?.focusScore ?? 0) >= 0.85) {
        severity = "critical";
    }
    else if (focusCluster.avgCentroidDistance >= 0.6 ||
        focusCluster.divergentHits >= 1 ||
        (agentFocus[0]?.focusScore ?? 0) >= 0.6) {
        severity = "warning";
    }
    if (partialIndexFailure) {
        confidence = "medium";
        unknowns.push("The top-drift list is unavailable until the windowId + driftVelocity Firestore index is deployed, so this drilldown leans on direct agent docs and top-divergent membership.");
    }
    if (behavioralCluster.sampledCount < behavioralCluster.size) {
        confidence = "medium";
        unknowns.push(`Behavioral cluster ${input.clusterId} exposes only a ${behavioralCluster.sampledCount}-agent sample out of ${behavioralCluster.size} members, so relationship overlap is based on the sampled slice while lead agents come from cluster-filtered top-divergent/top-drift lists.`);
    }
    const missingDetails = input.agentDetailCaptures.filter((capture) => capture.data === null);
    if (missingDetails.length > 0) {
        confidence = "medium";
        unknowns.push(`Some per-agent divergence docs were missing for this window (${missingDetails.map((capture) => capture.agentId).join(", ")}).`);
    }
    likelyCauses.push(`Cluster ${input.clusterId} carries ${focusCluster.divergentHits} currently top-divergent members across ${focusCluster.memberCount} agents.`);
    if (relationshipOverlaps.length > 0) {
        likelyCauses.push(`Relationship cluster ${relationshipOverlaps[0].clusterId} overlaps with ${relationshipOverlaps[0].overlapCount} of these agents, so the degradation signal is not isolated to a single conversation path.`);
    }
    nextActions.push(`Inspect recent posts and reply threads for ${agentFocus.slice(0, 3).map((agent) => agent.handle ?? agent.agentId).join(", ")}.`);
    if (relationshipOverlaps.length > 0) {
        nextActions.push(`Compare the behavioral cluster against relationship cluster ${relationshipOverlaps[0].clusterId} to see whether the same agents are socially reinforcing the drift.`);
    }
    if (partialIndexFailure) {
        nextActions.push("After the top-drift Firestore index is deployed, rerun cluster degradation and drilldown to confirm the same agents are still leading.");
    }
    safeSuggestedActions.push({
        action: `Review the top focus agents in behavioral cluster ${input.clusterId} in the admin UI.`,
        rationale: "The drilldown already narrowed the cluster to a bounded agent set, so the next step is a manual qualitative read of their recent behavior rather than broad scanning.",
        requiresApproval: false,
    });
    const topHandles = agentFocus
        .slice(0, 3)
        .map((agent) => agent.handle ?? agent.agentId)
        .join(", ");
    const summary = `Behavioral cluster ${input.clusterId} drilldown points to ${topHandles} as the leading degrading agents, with pressureScore=${focusCluster.pressureScore}, divergentHits=${focusCluster.divergentHits}, and avgCentroidDistance=${focusCluster.avgCentroidDistance}.`;
    const snapshotRefs = input.clusterSnapshot.snapshotRef
        ? [input.clusterSnapshot.snapshotRef]
        : [];
    const report = {
        affectedSystems: ["observability", "clustering", "divergence", "agent-behavior"],
        confidence,
        crossChecks: [
            "Matched the requested behavioral cluster against the live clustering snapshot.",
            "Verified a bounded set of member agents through /_admin/observability/divergence/agent/:agentId.",
            "Used relationship-cluster overlap only as supporting evidence.",
        ],
        evidence,
        generatedAt: new Date().toISOString(),
        likelyCauses,
        nextActions,
        recommendedCursorPrompt: `Explain why behavioral cluster ${input.clusterId} is degrading and name the top agents with the strongest supporting evidence.`,
        recommendedShellCommands: [
            "cd openclaw-railway",
            `npm run report:cluster-drilldown -- --cluster-id ${input.clusterId} --stdout-only`,
        ],
        safeSuggestedActions,
        schemaVersion: 1,
        severity,
        snapshotRefs,
        summary,
        title: input.title,
        type: "root-cause-investigation-note",
        unknowns,
    };
    return {
        agentFocus,
        focusCluster,
        relationshipOverlaps,
        report,
    };
}
export async function runClusterDrilldownReport(options) {
    const clusterSnapshot = options.clusterSnapshot ??
        (await agntsClusterHealthSnapshot({
            ...options,
            persist: options.writeReport ?? true,
        }));
    const behavioralCluster = readBehavioralClusterSample(clusterSnapshot, options.clusterId);
    const clusterMembers = behavioralCluster.members;
    const topDriftAgents = readClusterTopListMembers(asRecord(asRecord(clusterSnapshot.data).topDrift), options.clusterId);
    const topDivergentAgents = readClusterTopListMembers(asRecord(asRecord(clusterSnapshot.data).topDivergent), options.clusterId);
    const topDriftIds = new Set(topDriftAgents.map((agent) => agent.agentId));
    const topDivergentIds = new Set(topDivergentAgents.map((agent) => agent.agentId));
    const agentLimit = clamp(options.agentLimit ?? 6, 1, 10);
    const candidateAgentIds = mergeAgentRecords([
        topDivergentAgents,
        topDriftAgents,
        [...clusterMembers].sort((left, right) => computeCandidateScore(right, topDriftIds, topDivergentIds) -
            computeCandidateScore(left, topDriftIds, topDivergentIds)),
    ])
        .slice(0, agentLimit)
        .map((agent) => agent.agentId);
    const agentDetailCaptures = await fetchAgentDetailCaptures(candidateAgentIds, options.budget, extractWindowId(clusterSnapshot));
    const built = buildClusterDrilldownReport({
        agentDetailCaptures,
        clusterId: options.clusterId,
        clusterSnapshot,
        title: options.title ?? `AGNTS Cluster ${options.clusterId} Drilldown`,
    });
    const writtenReport = options.writeReport === false
        ? null
        : await writeOperatorReport(built.report, { workspaceDir: options.workspaceDir });
    return {
        agentFocus: built.agentFocus,
        clusterSnapshot,
        focusCluster: built.focusCluster,
        relationshipOverlaps: built.relationshipOverlaps,
        report: built.report,
        writtenReport,
    };
}
export function summarizeClusterWatchTrigger(degradation) {
    const topCluster = degradation.leadingBehavioralClusters[0];
    if (!topCluster) {
        return { clusterId: null, triggered: false };
    }
    return {
        clusterId: topCluster.clusterId,
        triggered: severityRank(degradation.report.severity) >= severityRank("warning"),
    };
}
//# sourceMappingURL=agntsClusterDrilldown.js.map