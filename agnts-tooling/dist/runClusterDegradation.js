import { runClusterDegradationReport } from "./agntsClusterDegradation.js";
function parseArgs(argv) {
    let stdoutOnly = false;
    for (const arg of argv) {
        if (arg === "--stdout-only") {
            stdoutOnly = true;
            continue;
        }
        if (arg === "--help") {
            console.log([
                "Usage:",
                "  npm run report:cluster-degradation -- [--stdout-only]",
                "",
                "Options:",
                "  --stdout-only   Do not write report files; print JSON only",
            ].join("\n"));
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return { stdoutOnly };
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await runClusterDegradationReport({
        writeReport: !options.stdoutOnly,
    });
    console.info(JSON.stringify({
        event: "openclaw_cluster_degradation_ok",
        leadingBehavioralClusters: result.leadingBehavioralClusters,
        leadingRelationshipClusters: result.leadingRelationshipClusters,
        report: result.report,
        clusterSnapshotRef: result.clusterSnapshot.snapshotRef,
        writtenReport: result.writtenReport,
    }));
}
main().catch((error) => {
    console.error(JSON.stringify({
        event: "openclaw_cluster_degradation_failed",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
});
//# sourceMappingURL=runClusterDegradation.js.map