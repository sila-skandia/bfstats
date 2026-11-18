// The colour every video we publish is written in: 4:2:0 at TV range (16-235),
// BT.709, tagged so. The frames the runners film are JPEGs, full range in
// BT.601, and ffmpeg 9 carries that range through `-pix_fmt yuv420p`: every
// Short, roll and recap went up as full-range H.264 (ffprobe's `yuvj420p`, range
// `pc`), which Reddit's upload refused with "unspecified error" (2026-11-18,
// features/replay-shorts, "Colour range").

/** Appended to a `scale` filter's options: converts the range and the matrix. */
export const TV_SCALE = 'out_range=tv:out_color_matrix=bt709';

/** After the scale: the pixel format and the tags a player and a transcoder read. */
export const TV_TAIL = 'format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';

/** A whole `-vf` chain for a scale expression (`trunc(iw/2)*2:trunc(ih/2)*2`,
 *  `-2:720:flags=lanczos`), or for none: the frames at their size, converted. */
export const tvFilter = (scale = '') => `scale=${scale ? `${scale}:` : ''}${TV_SCALE},${TV_TAIL}`;
