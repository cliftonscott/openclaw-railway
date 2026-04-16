import { runClusterWatchMonitor } from "./agntsClusterWatchMonitor.js";
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
                "  npm run monitor:cluster-watch -- [--stdout-only]",
                "",
                "Options:",
                "  --stdout-only   Print JSON only; still evaluates readiness and monitor state",
            ].join("\n"));
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return { stdoutOnly };
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await runClusterWatchMonitor({
        writeReport: !options.stdoutOnly,
    });
    console.info(JSON.stringify({
        event: "openclaw_cluster_watch_monitor_ok",
        result,
    }));
}
main().catch((error) => {
    console.error(JSON.stringify({
        event: "openclaw_cluster_watch_monitor_failed",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
});
//# sourceMappingURL=runClusterWatchMonitor.js.map