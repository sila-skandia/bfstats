/**
 * The file a template's model is stored under: its name with `/` spelled `_`.
 * A slash is legal in a Refractor template name (FHSW's `SdKfz251/1`,
 * `Flak18/36`) but would make a directory of the path; extract_models.py's
 * `model_file_stem` writes the files the same way.
 */
export function modelFileStem(name) {
  return String(name).replace(/[\\/]/g, '_');
}

// A manifest's name tables, lowercased once each.
const loweredTables = new WeakMap();

/**
 * `table[name]`, else the entry whose key is `name` in another case, else
 * undefined. The engine finds a template whatever its case
 * (`ObjectTemplateManager::getTemplate`, strcasecmp; ledger LOAD-7), and the
 * names reaching a manifest come from files that disagree: FHSW's kits hold
 * `Mp40` (the weapon's `create` line) where `gaits.json` and the pose files
 * say `MP40` (the animation states'). Every manifest looked up by a template
 * name goes through here; `pose-bases.js` `poseSources` does the same for the
 * pose files themselves, through each tree's `poses/index.json`.
 */
export function byName(table, name) {
  if (!table || name == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(table, name)) return table[name];
  let lowered = loweredTables.get(table);
  if (!lowered) {
    lowered = new Map();
    for (const [key, value] of Object.entries(table)) {
      const low = key.toLowerCase();
      if (!lowered.has(low)) lowered.set(low, value);
    }
    loweredTables.set(table, lowered);
  }
  return lowered.get(String(name).toLowerCase());
}
