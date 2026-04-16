import { runClusterDrilldownReport } from "./agntsClusterDrilldown.js";
function parseArgs(argv) {
    let clusterId = null;
    let stdoutOnly = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--stdout-only") {
            stdoutOnly = true;
            continue;
        }
        if (arg === "--cluster-id") {
            const value = argv[index + 1];
            if (!value) {
                throw new Error("--cluster-id requires a numeric value");
            }
            const parsed = Number.parseInt(value, 10);
            if (!Number.isFinite(parsed)) {
                throw new Error(`Invalid --cluster-id value: ${value}`);
            }
            clusterId = parsed;
            index += 1;
            continue;
        }
        if (arg === "--help") {
            console.log([
                "Usage:",
                "  npm run report:cluster-drilldown -- --cluster-id <id> [--stdout-only]",
                "",
                "Options:",
                "  --cluster-id <id>   Behavioral cluster id to investigate",
                "  --stdout-only       Do not write report files; print JSON only",
            ].join("\n"));
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (clusterId === null) {
        throw new Error("--cluster-id is required");
    }
    return { clusterId, stdoutOnly };
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await runClusterDrilldownReport({
        clusterId: options.clusterId,
        writeReport: !options.stdoutOnly,
    });
    console.info(JSON.stringify({
        event: "openclaw_cluster_drilldown_ok",
        agentFocus: result.agentFocus,
        focusCluster: result.focusCluster,
        relationshipOverlaps: result.relationshipOverlaps,
        report: result.report,
        clusterSnapshotRef: result.clusterSnapshot.snapshotRef,
        writtenReport: result.writtenReport,
    }));
}
main().catch((error) => {
    console.error(JSON.stringify({
        event: "openclaw_cluster_drilldown_failed",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
});
//# sourceMappingURL=runClusterDrilldown.js.map