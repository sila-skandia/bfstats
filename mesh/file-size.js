// X-File-Size on a pre-compressed response (features/mesh-asset-size, phase 2a/2b).
//
// gzip_static sends `<name>.glb.gz` (and brotli_static `<name>.glb.br`) with a
// Content-Length of the compressed copy, but the browser counts the inflated
// bytes as they arrive: three's FileLoader, which reports a level's download
// progress, would pass 100% at 40% (gzip) or 20% (brotli) of the way. It reads
// X-File-Size first for exactly this, so give it the size of the file the
// response inflates to. One stat of a file nginx has just opened the sibling
// of; nothing is read.
import fs from 'fs';

function fileSize(r) {
    const encoding = r.headersOut['Content-Encoding'];
    if (encoding !== 'gzip' && encoding !== 'br') return;
    try {
        r.headersOut['X-File-Size'] = String(fs.statSync(r.variables.request_filename).size);
    } catch (e) {
        // No plain file beside the copy: leave the header out, and the loader
        // falls back to Content-Length.
    }
}

export default { fileSize };
