/**
 * The file a template's model is stored under: its name with `/` spelled `_`.
 * A slash is legal in a Refractor template name (FHSW's `SdKfz251/1`,
 * `Flak18/36`) but would make a directory of the path; extract_models.py's
 * `model_file_stem` writes the files the same way.
 */
export function modelFileStem(name) {
  return String(name).replace(/[\\/]/g, '_');
}
