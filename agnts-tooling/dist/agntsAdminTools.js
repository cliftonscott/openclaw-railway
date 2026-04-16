import { agntsAdminGet, OpenClawAdminApiError, } from "./agntsAdminApi.js";
import { appendSnapshotRecord, } from "./agntsSnapshotStore.js";
async function maybePersistSnapshot(profile, capturedAt, data, options) {
    if (!options.persist) {
        return null;
    }
    const snapshotOptions = {
        capturedAt,
        retentionDays: options.retentionDays,
        workspaceDir: options.workspaceDir,
    };
    return appendSnapshotRecord(profile, data, snapshotOptions);
}
export async function agntsRuntimeSnapshot(options = {}) {
    const capturedAt = new Date().toISOString();
    const runtimeConfig = await agntsAdminGet("/_admin/runtime-config", {
        budget: {
            cacheTtlMs: 60_000,
            ...(options.budget ?? {}),
        },
    });
    const data = {
        capturedAt,
        runtimeConfig: runtimeConfig.data ?? {},
        route: "/_admin/runtime-config",
        transport: {
            budgetUsage: runtimeConfig.budgetUsage,
            durationMs: runtimeConfig.durationMs,
            requestId: runtimeConfig.requestId,
            status: runtimeConfig.status,
            textHash: runtimeConfig.textHash,
        },
    };
    return {
        capturedAt,
        data,
        snapshotRef: await maybePersistSnapshot("runtime-snapshot", capturedAt, data, options),
    };
}
async function captureOptionalAdminGet(path, options = {}) {
    try {
        const response = await agntsAdminGet(path, options);
        return {
            data: response.data ?? { error: "empty_response" },
            transport: {
                budgetUsage: response.budgetUsage,
                durationMs: response.durationMs,
                requestId: response.requestId,
                status: response.status,
                textHash: response.textHash,
            },
        };
    }
    catch (error) {
        if (error instanceof OpenClawAdminApiError &&
            error.status === 403 &&
            error.bodyText.includes("divergence_disabled")) {
            return {
                data: { error: "divergence_disabled" },
                transport: {
                    durationMs: error.durationMs,
                    error: error.bodyText,
                    requestId: error.requestId,
                    status: error.status,
                },
            };
        }
        if (error instanceof OpenClawAdminApiError &&
            error.status >= 500 &&
            (error.bodyText.includes("FAILED_PRECONDITION") ||
                error.bodyText.includes("requires an index"))) {
            return {
                data: { error: "index_required" },
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
}
export async function agntsSchedulerHealthSnapshot(options = {}) {
    const capturedAt = new Date().toISOString();
    const [healthState, tickLogs, newsIngestStatus] = await Promise.all([
        agntsAdminGet("/_admin/health-state", {
            budget: options.budget,
        }),
        agntsAdminGet("/_admin/tick-logs", {
            budget: options.budget,
            query: { limit: 10 },
        }),
        agntsAdminGet("/_admin/news-ingest/status", {
            budget: options.budget,
        }),
    ]);
    const data = {
        capturedAt,
        healthState: healthState.data ?? {},
        newsIngestStatus: newsIngestStatus.data ?? {},
        tickLogs: tickLogs.data ?? {},
        transport: {
            healthState: {
                budgetUsage: healthState.budgetUsage,
                durationMs: healthState.durationMs,
                requestId: healthState.requestId,
                status: healthState.status,
                textHash: healthState.textHash,
            },
            newsIngestStatus: {
                budgetUsage: newsIngestStatus.budgetUsage,
                durationMs: newsIngestStatus.durationMs,
                requestId: newsIngestStatus.requestId,
                status: newsIngestStatus.status,
                textHash: newsIngestStatus.textHash,
            },
            tickLogs: {
                budgetUsage: tickLogs.budgetUsage,
                durationMs: tickLogs.durationMs,
                requestId: tickLogs.requestId,
                status: tickLogs.status,
                textHash: tickLogs.textHash,
            },
        },
    };
    return {
        capturedAt,
        data,
        snapshotRef: await maybePersistSnapshot("scheduler-health", capturedAt, data, options),
    };
}
export async function agntsObservabilitySnapshot(options = {}) {
    const capturedAt = new Date().toISOString();
    const [pulse, counters, latestReview] = await Promise.all([
        agntsAdminGet("/_admin/observability/pulse", {
            budget: options.budget,
        }),
        agntsAdminGet("/_admin/observability/counters", {
            budget: options.budget,
        }),
        agntsAdminGet("/_admin/operator/openclaw/latest-review", {
            budget: options.budget,
        }),
    ]);
    const data = {
        capturedAt,
        counters: counters.data ?? {},
        latestReview: latestReview.data ?? {},
        pulse: pulse.data ?? {},
        transport: {
            counters: {
                budgetUsage: counters.budgetUsage,
                durationMs: counters.durationMs,
                requestId: counters.requestId,
                status: counters.status,
                textHash: counters.textHash,
            },
            latestReview: {
                budgetUsage: latestReview.budgetUsage,
                durationMs: latestReview.durationMs,
                requestId: latestReview.requestId,
                status: latestReview.status,
                textHash: latestReview.textHash,
            },
            pulse: {
                budgetUsage: pulse.budgetUsage,
                durationMs: pulse.durationMs,
                requestId: pulse.requestId,
                status: pulse.status,
                textHash: pulse.textHash,
            },
        },
    };
    return {
        capturedAt,
        data,
        snapshotRef: await maybePersistSnapshot("observability-snapshot", capturedAt, data, options),
    };
}
export async function agntsModerationHealthSnapshot(options = {}) {
    const capturedAt = new Date().toISOString();
    const [quarantine, alerts] = await Promise.all([
        agntsAdminGet("/_admin/quarantine", {
            budget: options.budget,
            query: { limit: 25, status: "pending" },
        }),
        agntsAdminGet("/_admin/alerts", {
            budget: options.budget,
            query: { limit: 25 },
        }),
    ]);
    const data = {
        alerts: alerts.data ?? {},
        capturedAt,
        quarantine: quarantine.data ?? {},
        transport: {
            alerts: {
                budgetUsage: alerts.budgetUsage,
                durationMs: alerts.durationMs,
                requestId: alerts.requestId,
                status: alerts.status,
                textHash: alerts.textHash,
            },
            quarantine: {
                budgetUsage: quarantine.budgetUsage,
                durationMs: quarantine.durationMs,
                requestId: quarantine.requestId,
                status: quarantine.status,
                textHash: quarantine.textHash,
            },
        },
    };
    return {
        capturedAt,
        data,
        snapshotRef: await maybePersistSnapshot("moderation-health", capturedAt, data, options),
    };
}
export async function agntsClusterHealthSnapshot(options = {}) {
    const capturedAt = new Date().toISOString();
    const [behavioral, relationship, divergencePopulation, divergenceTrend, topDrift, topDivergent,] = await Promise.all([
        captureOptionalAdminGet("/_admin/observability/clustering/behavioral", {
            budget: options.budget,
        }),
        agntsAdminGet("/_admin/observability/clustering/relationship", {
            budget: options.budget,
        }),
        captureOptionalAdminGet("/_admin/observability/divergence/population", {
            budget: options.budget,
        }),
        captureOptionalAdminGet("/_admin/observability/divergence/trend", {
            budget: options.budget,
            query: { limit: 5 },
        }),
        captureOptionalAdminGet("/_admin/observability/divergence/agents/top-drift", {
            budget: options.budget,
            query: { limit: 20 },
        }),
        captureOptionalAdminGet("/_admin/observability/divergence/agents/top-divergent", {
            budget: options.budget,
            query: { limit: 20 },
        }),
    ]);
    const data = {
        behavioral: behavioral.data,
        capturedAt,
        divergencePopulation: divergencePopulation.data,
        divergenceTrend: divergenceTrend.data,
        relationship: relationship.data ?? {},
        topDivergent: topDivergent.data,
        topDrift: topDrift.data,
        transport: {
            behavioral: behavioral.transport,
            divergencePopulation: divergencePopulation.transport,
            divergenceTrend: divergenceTrend.transport,
            relationship: {
                budgetUsage: relationship.budgetUsage,
                durationMs: relationship.durationMs,
                requestId: relationship.requestId,
                status: relationship.status,
                textHash: relationship.textHash,
            },
            topDivergent: topDivergent.transport,
            topDrift: topDrift.transport,
        },
    };
    return {
        capturedAt,
        data,
        snapshotRef: await maybePersistSnapshot("cluster-health", capturedAt, data, options),
    };
}
//# sourceMappingURL=agntsAdminTools.js.map