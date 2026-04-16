/**
 * Wrapper-owned config sanitation for legacy or invalid fields that the
 * upstream OpenClaw config may tolerate poorly across upgrades.
 */

/**
 * Remove stale plugin config that older deployments left behind.
 *
 * @param {Record<string, any>} config
 * @returns {{ changed: boolean, changes: string[] }}
 */
export function sanitizeConfig(config) {
  const changes = [];

  if (!config || typeof config !== 'object') {
    return { changed: false, changes };
  }

  const entries = config.plugins?.entries;
  const memoryCoreEntry = entries?.['memory-core'];
  if (memoryCoreEntry && typeof memoryCoreEntry === 'object' && 'config' in memoryCoreEntry) {
    delete memoryCoreEntry.config;
    changes.push('plugins.entries.memory-core.config removed');
    if (Object.keys(memoryCoreEntry).length === 0) {
      delete entries['memory-core'];
      changes.push('plugins.entries.memory-core removed (empty)');
    }
  }

  return { changed: changes.length > 0, changes };
}
