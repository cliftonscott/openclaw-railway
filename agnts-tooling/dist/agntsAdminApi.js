import { createHash } from "node:crypto";
import { clearOpenClawAdminTokenCache, getOpenClawAdminAccessToken, } from "./agntsAdminAuth.js";
const DEFAULT_ADMIN_BASE_URL = "https://us-central1-drift-55edb.cloudfunctions.net/adminApi";
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_READ_SCOPE = "openid admin.read";
const DEFAULT_WRITE_SCOPE = "openid admin.read admin.write";
const responseCache = new Map();
export class OpenClawAdminApiError extends Error {
    bodyText;
    durationMs;
    headersSubset;
    method;
    path;
    requestId;
    status;
    constructor(options) {
        const requestIdSuffix = options.requestId ? `, requestId=${options.requestId}` : "";
        super(`OpenClaw admin API ${options.method} ${options.path} failed (${options.status}${requestIdSuffix}): ${options.bodyText}`);
        this.name = "OpenClawAdminApiError";
        this.bodyText = options.bodyText;
        this.durationMs = options.durationMs;
        this.headersSubset = options.headersSubset;
        this.method = options.method;
        this.path = options.path;
        this.requestId = options.requestId;
        this.status = options.status;
    }
}
function getAdminBaseUrl() {
    const configured = process.env.AGNTS_ADMIN_API_BASE_URL?.trim();
    return (configured || DEFAULT_ADMIN_BASE_URL).replace(/\/+$/, "");
}
function normalizePath(path) {
    const trimmed = path.trim();
    if (!trimmed) {
        throw new Error("Admin API path is required");
    }
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
function normalizeScope(method, scope, forceWriteScope) {
    if (scope?.trim()) {
        return scope.trim();
    }
    if (forceWriteScope || method !== "GET" && method !== "HEAD") {
        return DEFAULT_WRITE_SCOPE;
    }
    return DEFAULT_READ_SCOPE;
}
function normalizeBudget(budget) {
    return {
        cacheTtlMs: Math.max(0, budget?.cacheTtlMs ?? 0),
        maxResponseBytes: Math.max(1024, budget?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES),
        retryUnauthorizedOnce: budget?.retryUnauthorizedOnce ?? true,
        timeoutMs: Math.max(1000, budget?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
}
function buildUrl(pathValue, query) {
    const url = new URL(`${getAdminBaseUrl()}${normalizePath(pathValue)}`);
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value === undefined || value === null) {
            continue;
        }
        url.searchParams.set(key, String(value));
    }
    return url.toString();
}
function normalizeRequest(options) {
    const method = options.method ?? "GET";
    const budget = normalizeBudget(options.budget);
    const url = buildUrl(options.path, options.query);
    const scope = normalizeScope(method, options.scope, options.forceWriteScope ?? false);
    return {
        budget,
        cacheKey: `${method}:${url}:${scope}`,
        method,
        scope,
        url,
    };
}
function pickHeaderSubset(headers) {
    const interestingHeaders = [
        "content-type",
        "x-debug-tracking-id",
        "x-request-id",
        "x-cloud-trace-context",
    ];
    return interestingHeaders.reduce((accumulator, headerName) => {
        const value = headers.get(headerName);
        if (value) {
            accumulator[headerName] = value;
        }
        return accumulator;
    }, {});
}
function computeTextHash(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}
function describeError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function truncateText(text, maxResponseBytes) {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes <= maxResponseBytes) {
        return { text, truncated: false };
    }
    const buffer = Buffer.from(text, "utf8");
    return {
        text: buffer.subarray(0, maxResponseBytes).toString("utf8"),
        truncated: true,
    };
}
export function redactAdminSecrets(input) {
    return input
        .replace(/Authorization:\s*(?:Bearer|Basic)\s+[^\s"']+/gi, "Authorization: [REDACTED]")
        .replace(/\bBearer\s+[A-Za-z0-9\-_.]+\b/g, "Bearer [REDACTED]")
        .replace(/\bBasic\s+[A-Za-z0-9+/=]+\b/g, "Basic [REDACTED]")
        .replace(/\bagnts_secret_[A-Za-z0-9]+\b/g, "[REDACTED_SECRET]");
}
function parseResponseData(text, headers, truncated) {
    if (!text || truncated) {
        return undefined;
    }
    const contentType = headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
        try {
            return JSON.parse(text);
        }
        catch {
            return undefined;
        }
    }
    return JSON.parse(text);
}
async function performRequest(options, normalized, didRetry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalized.budget.timeoutMs);
    const startedAt = Date.now();
    try {
        const token = await getOpenClawAdminAccessToken(normalized.scope);
        const response = await fetch(normalized.url, {
            method: normalized.method,
            headers: {
                Authorization: `${token.tokenType} ${token.accessToken}`,
                ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
                ...(options.headers ?? {}),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: controller.signal,
        });
        const rawText = await response.text();
        const durationMs = Date.now() - startedAt;
        const responseBytes = Buffer.byteLength(rawText, "utf8");
        const { text, truncated } = truncateText(rawText, normalized.budget.maxResponseBytes);
        const requestId = response.headers.get("x-debug-tracking-id") ??
            response.headers.get("x-request-id") ??
            response.headers.get("x-cloud-trace-context");
        const headersSubset = pickHeaderSubset(response.headers);
        const budgetUsage = {
            cacheHit: false,
            cacheTtlMs: normalized.budget.cacheTtlMs,
            maxResponseBytes: normalized.budget.maxResponseBytes,
            responseBytes,
            retriedAfterUnauthorized: didRetry,
            timeoutMs: normalized.budget.timeoutMs,
            truncated,
        };
        if (response.status === 401 &&
            normalized.budget.retryUnauthorizedOnce &&
            !didRetry) {
            clearOpenClawAdminTokenCache();
            return performRequest(options, normalized, true);
        }
        if (!response.ok) {
            throw new OpenClawAdminApiError({
                bodyText: redactAdminSecrets(text),
                durationMs,
                headersSubset,
                method: normalized.method,
                path: options.path,
                requestId,
                status: response.status,
            });
        }
        return {
            budgetUsage,
            data: parseResponseData(text, response.headers, truncated),
            durationMs,
            headersSubset,
            requestId,
            status: response.status,
            text,
            textHash: computeTextHash(text),
        };
    }
    catch (error) {
        if (error instanceof OpenClawAdminApiError) {
            throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`OpenClaw admin API ${normalized.method} ${options.path} timed out after ${normalized.budget.timeoutMs}ms`);
        }
        throw new Error(`OpenClaw admin API ${normalized.method} ${options.path} request failed: ${describeError(error)}`, { cause: error instanceof Error ? error : undefined });
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function agntsAdminRequest(options) {
    const normalized = normalizeRequest(options);
    const shouldCache = normalized.method === "GET" && normalized.budget.cacheTtlMs > 0;
    const now = Date.now();
    const cached = shouldCache ? responseCache.get(normalized.cacheKey) : undefined;
    if (cached && cached.expiresAtMs > now) {
        return {
            ...cached.value,
            budgetUsage: {
                ...cached.value.budgetUsage,
                cacheHit: true,
            },
        };
    }
    const result = await performRequest(options, normalized, false);
    if (shouldCache) {
        responseCache.set(normalized.cacheKey, {
            expiresAtMs: now + normalized.budget.cacheTtlMs,
            value: result,
        });
    }
    return result;
}
export async function agntsAdminGet(path, options = {}) {
    return agntsAdminRequest({
        ...options,
        method: "GET",
        path,
    });
}
export function clearOpenClawAdminResponseCache() {
    responseCache.clear();
}
export async function callOpenClawAdminApi(options) {
    const result = await agntsAdminRequest(options);
    return { status: result.status, data: result.data };
}
//# sourceMappingURL=agntsAdminApi.js.map