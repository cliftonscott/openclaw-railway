import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_WORKSPACE_DIR = path.resolve(process.cwd(), "workspace");
function getWorkspaceDir(workspaceDir) {
    if (workspaceDir && workspaceDir.trim().length > 0) {
        return path.resolve(workspaceDir);
    }
    const configured = process.env.OPENCLAW_WORKSPACE_DIR?.trim();
    if (configured && configured.length > 0) {
        const resolved = path.resolve(configured);
        if (existsSync(resolved) || resolved.startsWith(process.cwd())) {
            return resolved;
        }
    }
    return DEFAULT_WORKSPACE_DIR;
}
export function getOpenClawSnapshotDir(workspaceDir) {
    return path.join(getWorkspaceDir(workspaceDir), "openclaw", "snapshots");
}
function slugifyProfile(profile) {
    return profile.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export async function appendSnapshotRecord(profile, data, options = {}) {
    const safeProfile = slugifyProfile(profile);
    if (!safeProfile) {
        throw new Error("Snapshot profile is required");
    }
    const snapshotDir = getOpenClawSnapshotDir(options.workspaceDir);
    const workspaceDir = getWorkspaceDir(options.workspaceDir);
    const capturedAt = options.capturedAt ?? new Date().toISOString();
    const envelope = {
        capturedAt,
        data,
        metadata: options.metadata,
        profile: safeProfile,
        schemaVersion: 1,
    };
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
    const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
    const filename = `${capturedAt}__${sha256.slice(0, 8)}__${safeProfile}.json`;
    const absolutePath = path.join(snapshotDir, filename);
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(absolutePath, serialized, "utf8");
    await pruneExpiredSnapshots({
        retentionDays: options.retentionDays ?? DEFAULT_RETENTION_DAYS,
        workspaceDir,
    });
    return {
        absolutePath,
        capturedAt,
        profile: safeProfile,
        relativePath: path.relative(workspaceDir, absolutePath),
        sha256,
        snapshotId: filename.replace(/\.json$/u, ""),
    };
}
export async function readSnapshotRecord(snapshotIdOrPath, options = {}) {
    const absolutePath = resolveSnapshotAbsolutePath(snapshotIdOrPath, options.workspaceDir);
    const content = await readFile(absolutePath, "utf8");
    return JSON.parse(content);
}
export function resolveSnapshotAbsolutePath(snapshotIdOrPath, workspaceDir) {
    const resolvedWorkspaceDir = getWorkspaceDir(workspaceDir);
    return path.isAbsolute(snapshotIdOrPath)
        ? snapshotIdOrPath
        : snapshotIdOrPath.endsWith(".json") || snapshotIdOrPath.includes(path.sep)
            ? path.join(resolvedWorkspaceDir, snapshotIdOrPath)
            : path.join(getOpenClawSnapshotDir(resolvedWorkspaceDir), `${snapshotIdOrPath}.json`);
}
export async function resolveSnapshotRef(snapshotIdOrPath, options = {}) {
    const workspaceDir = getWorkspaceDir(options.workspaceDir);
    const absolutePath = resolveSnapshotAbsolutePath(snapshotIdOrPath, workspaceDir);
    const content = await readFile(absolutePath, "utf8");
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
    const parsed = JSON.parse(content);
    return {
        absolutePath,
        capturedAt: parsed.capturedAt,
        profile: parsed.profile,
        relativePath: path.relative(workspaceDir, absolutePath),
        sha256,
        snapshotId: path.basename(absolutePath, ".json"),
    };
}
export async function pruneExpiredSnapshots(options = {}) {
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const snapshotDir = getOpenClawSnapshotDir(options.workspaceDir);
    await mkdir(snapshotDir, { recursive: true });
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await readdir(snapshotDir, { withFileTypes: true });
    const deleted = [];
    const kept = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
            continue;
        }
        const absolutePath = path.join(snapshotDir, entry.name);
        const entryStat = await stat(absolutePath);
        if (entryStat.mtimeMs < cutoffMs) {
            await rm(absolutePath);
            deleted.push(entry.name);
            continue;
        }
        kept.push(entry.name);
    }
    return { deleted: deleted.sort(), kept: kept.sort() };
}
//# sourceMappingURL=agntsSnapshotStore.js.map