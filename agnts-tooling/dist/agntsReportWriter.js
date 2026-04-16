import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOpenClawSnapshotDir } from "./agntsSnapshotStore.js";
const DEFAULT_REPORTS_DIR = path.resolve(process.cwd(), "workspace", "openclaw", "reports");
function slugify(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function getReportsDir(workspaceDir) {
    if (!workspaceDir) {
        return DEFAULT_REPORTS_DIR;
    }
    return path.resolve(workspaceDir, "openclaw", "reports");
}
function formatAction(action) {
    const approval = action.requiresApproval ? "Requires approval" : "Read-only";
    return `- ${action.action} (${approval})\n  ${action.rationale}`;
}
export function renderOperatorReportMarkdown(report) {
    const lines = [
        `# ${report.title}`,
        "",
        `- Type: \`${report.type}\``,
        `- Generated: \`${report.generatedAt}\``,
        `- Severity: \`${report.severity}\``,
        `- Confidence: \`${report.confidence}\``,
        "",
        "## Summary",
        "",
        report.summary,
        "",
        "## Affected Systems",
        "",
        ...(report.affectedSystems.length > 0
            ? report.affectedSystems.map((systemName) => `- ${systemName}`)
            : ["- none identified"]),
        "",
        "## Evidence",
        "",
        ...(report.evidence.length > 0
            ? report.evidence.flatMap((item) => {
                const metaParts = [
                    item.route ? `route: \`${item.route}\`` : null,
                    item.requestId ? `requestId: \`${item.requestId}\`` : null,
                    item.textHash ? `hash: \`${item.textHash.slice(0, 16)}\`` : null,
                ].filter(Boolean);
                return [
                    `- **${item.title}** — ${item.summary}`,
                    `  source: ${item.source}${metaParts.length > 0 ? `; ${metaParts.join("; ")}` : ""}`,
                ];
            })
            : ["- no evidence captured"]),
        "",
        "## Cross-checks",
        "",
        ...(report.crossChecks.length > 0
            ? report.crossChecks.map((value) => `- ${value}`)
            : ["- none recorded"]),
        "",
        "## Likely Causes",
        "",
        ...(report.likelyCauses.length > 0
            ? report.likelyCauses.map((value) => `- ${value}`)
            : ["- no likely cause identified"]),
        "",
        "## Unknowns",
        "",
        ...(report.unknowns.length > 0 ? report.unknowns.map((value) => `- ${value}`) : ["- none"]),
        "",
        "## Next Actions",
        "",
        ...(report.nextActions.length > 0
            ? report.nextActions.map((value) => `- ${value}`)
            : ["- none"]),
        "",
        "## Safe Suggested Actions",
        "",
        ...(report.safeSuggestedActions.length > 0
            ? report.safeSuggestedActions.flatMap((action) => formatAction(action).split("\n"))
            : ["- none"]),
        "",
        "## Snapshot Refs",
        "",
        ...(report.snapshotRefs.length > 0
            ? report.snapshotRefs.map((snapshotRef) => `- \`${snapshotRef.snapshotId}\` — \`${snapshotRef.relativePath}\` (\`${snapshotRef.sha256.slice(0, 16)}\`)`)
            : ["- none"]),
    ];
    if (report.recommendedCursorPrompt) {
        lines.push("", "## Recommended Cursor Prompt", "", "```text", report.recommendedCursorPrompt, "```");
    }
    if (report.recommendedShellCommands.length > 0) {
        lines.push("", "## Recommended Shell", "", "```bash", ...report.recommendedShellCommands, "```");
    }
    return `${lines.join("\n")}\n`;
}
function buildReportFilename(report, extension) {
    const contentSeed = JSON.stringify(report);
    const sha256 = createHash("sha256").update(contentSeed, "utf8").digest("hex");
    const slug = slugify(`${report.type}-${report.title}`) || report.type;
    const reportId = `${report.generatedAt}__${sha256.slice(0, 8)}__${slug}`;
    return {
        filename: `${reportId}.${extension}`,
        reportId,
        sha256,
    };
}
export async function writeOperatorReport(report, options = {}) {
    const reportsDir = getReportsDir(options.workspaceDir);
    await mkdir(reportsDir, { recursive: true });
    const jsonInfo = buildReportFilename(report, "json");
    const markdownInfo = buildReportFilename(report, "md");
    const jsonAbsolutePath = path.join(reportsDir, jsonInfo.filename);
    const markdownAbsolutePath = path.join(reportsDir, markdownInfo.filename);
    const jsonBody = `${JSON.stringify(report, null, 2)}\n`;
    const markdownBody = renderOperatorReportMarkdown(report);
    await Promise.all([
        writeFile(jsonAbsolutePath, jsonBody, "utf8"),
        writeFile(markdownAbsolutePath, markdownBody, "utf8"),
    ]);
    const workspaceRoot = path.dirname(path.dirname(getOpenClawSnapshotDir(options.workspaceDir)));
    return {
        jsonRef: {
            absolutePath: jsonAbsolutePath,
            format: "json",
            relativePath: path.relative(workspaceRoot, jsonAbsolutePath),
            reportId: jsonInfo.reportId,
            sha256: createHash("sha256").update(jsonBody, "utf8").digest("hex"),
        },
        markdownRef: {
            absolutePath: markdownAbsolutePath,
            format: "md",
            relativePath: path.relative(workspaceRoot, markdownAbsolutePath),
            reportId: markdownInfo.reportId,
            sha256: createHash("sha256").update(markdownBody, "utf8").digest("hex"),
        },
        report,
    };
}
//# sourceMappingURL=agntsReportWriter.js.map