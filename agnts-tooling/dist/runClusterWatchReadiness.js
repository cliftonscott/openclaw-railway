import { runClusterWatchReadiness } from "./agntsClusterWatchReadiness.js";
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
                "  npm run verify:cluster-watch-readiness -- [--stdout-only]",
                "",
                "Options:",
                "  --stdout-only   Do not write report files while probing readiness; print JSON only",
            ].join("\n"));
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return { stdoutOnly };
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await runClusterWatchReadiness({
        writeReport: !options.stdoutOnly,
    });
    console.info(JSON.stringify({
        event: "openclaw_cluster_watch_readiness_ok",
        result,
    }));
}
main().catch((error) => {
    console.error(JSON.stringify({
        event: "openclaw_cluster_watch_readiness_failed",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
});
//# sourceMappingURL=runClusterWatchReadiness.js.map