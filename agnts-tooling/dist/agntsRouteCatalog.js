import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const routeCatalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/ops/openclaw-route-catalog/openclaw-route-catalog.json");
let routeCatalogCache = null;
export async function loadOpenClawRouteCatalog() {
    if (routeCatalogCache) {
        return routeCatalogCache;
    }
    const raw = await readFile(routeCatalogPath, "utf8");
    const parsed = JSON.parse(raw);
    routeCatalogCache = parsed;
    return parsed;
}
export async function getOpenClawRouteById(routeId) {
    const catalog = await loadOpenClawRouteCatalog();
    const route = catalog.routes.find((entry) => entry.id === routeId);
    if (!route) {
        throw new Error(`OpenClaw route catalog entry not found for routeId=${routeId}`);
    }
    return route;
}
export function clearOpenClawRouteCatalogCache() {
    routeCatalogCache = null;
}
//# sourceMappingURL=agntsRouteCatalog.js.map