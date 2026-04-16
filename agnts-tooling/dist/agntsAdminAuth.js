const DEFAULT_TOKEN_URL = "https://developers.agnts.social/oidc/token";
const DEFAULT_SERVICE_ID = "openclaw";
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const tokenCache = new Map();
function trimRequiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required for AGNTS admin API access`);
    }
    return value;
}
export function getOpenClawAdminEnv() {
    return {
        clientId: trimRequiredEnv("AGNTS_ADMIN_CLIENT_ID"),
        clientSecret: trimRequiredEnv("AGNTS_ADMIN_CLIENT_SECRET"),
        serviceId: process.env.AGNTS_ADMIN_SERVICE_ID?.trim() || DEFAULT_SERVICE_ID,
        tokenUrl: process.env.AGNTS_ADMIN_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL,
    };
}
function normalizeScope(scope) {
    const deduped = Array.from(new Set(scope
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)));
    if (deduped.length === 0) {
        throw new Error("At least one scope is required");
    }
    if (!deduped.includes("openid")) {
        deduped.unshift("openid");
    }
    return deduped.join(" ");
}
function buildCacheKey(env, scope) {
    return `${env.clientId}:${env.serviceId}:${scope}`;
}
function describeError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
async function requestNewToken(env, scope) {
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        service_id: env.serviceId,
        scope,
    });
    const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`, "utf8").toString("base64");
    let response;
    try {
        response = await fetch(env.tokenUrl, {
            method: "POST",
            headers: {
                Authorization: `Basic ${basic}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
    }
    catch (error) {
        throw new Error(`OpenClaw admin token mint request failed (POST ${env.tokenUrl}): ${describeError(error)}`, { cause: error instanceof Error ? error : undefined });
    }
    const rawText = await response.text();
    let parsed = rawText;
    if (rawText.length > 0) {
        try {
            parsed = JSON.parse(rawText);
        }
        catch {
            parsed = rawText;
        }
    }
    if (!response.ok) {
        throw new Error(`OpenClaw admin token mint failed (${response.status}): ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
    }
    const json = parsed;
    if (!json.access_token || typeof json.access_token !== "string") {
        throw new Error("OpenClaw admin token mint succeeded without access_token");
    }
    const expiresInSec = typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 900;
    return {
        accessToken: json.access_token,
        tokenType: json.token_type?.trim() || "Bearer",
        expiresAtMs: Date.now() + expiresInSec * 1000,
        scope: json.scope?.trim() || scope,
    };
}
export async function getOpenClawAdminAccessToken(requestedScope) {
    const env = getOpenClawAdminEnv();
    const normalizedScope = normalizeScope(requestedScope);
    const cacheKey = buildCacheKey(env, normalizedScope);
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAtMs - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
        return cached;
    }
    const minted = await requestNewToken(env, normalizedScope);
    tokenCache.set(cacheKey, minted);
    return minted;
}
export function clearOpenClawAdminTokenCache() {
    tokenCache.clear();
}
export function decodeJwtPayload(token) {
    const parts = token.split(".");
    if (parts.length < 2) {
        throw new Error("Invalid JWT format");
    }
    const payload = parts[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const json = Buffer.from(`${normalized}${pad}`, "base64").toString("utf8");
    return JSON.parse(json);
}
//# sourceMappingURL=agntsAdminAuth.js.map