import { runClusterWatch } from "./agntsClusterWatch.js";
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
                "  npm run report:cluster-watch -- [--stdout-only]",
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
    const result = await runClusterWatch({
        writeReport: !options.stdoutOnly,
    });
    console.info(JSON.stringify({
        event: "openclaw_cluster_watch_ok",
        triggered: result.triggered,
        degradation: {
            leadingBehavioralClusters: result.degradation.leadingBehavioralClusters,
            leadingRelationshipClusters: result.degradation.leadingRelationshipClusters,
            report: result.degradation.report,
        },
        drilldown: result.drilldown
            ? {
                agentFocus: result.drilldown.agentFocus,
                focusCluster: result.drilldown.focusCluster,
                report: result.drilldown.report,
            }
            : null,
        report: result.report,
        writtenReport: result.writtenReport,
    }));
}
main().catch((error) => {
    console.error(JSON.stringify({
        event: "openclaw_cluster_watch_failed",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
});
//# sourceMappingURL=runClusterWatch.js.map