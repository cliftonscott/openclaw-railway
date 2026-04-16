import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const rubricPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/ops/openclaw-threshold-rubric.yaml");
let rubricCache = null;
export async function loadOpenClawThresholdRubric() {
    if (rubricCache) {
        return rubricCache;
    }
    const raw = await readFile(rubricPath, "utf8");
    const parsed = JSON.parse(raw);
    rubricCache = parsed;
    return parsed;
}
export function clearOpenClawThresholdRubricCache() {
    rubricCache = null;
}
//# sourceMappingURL=agntsRubric.js.map