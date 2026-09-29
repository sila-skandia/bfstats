// X-File-Size on a pre-compressed response (features/mesh-asset-size, phase 2a).
//
// gzip_static sends `<name>.glb.gz` with a Content-Length of the gzip, but the
// browser counts the inflated bytes as they arrive: three's FileLoader, which
// reports a level's download progress, would pass 100% at 40% of the way. It
// reads X-File-Size first for exactly this, so give it the size of the file
// the response inflates to. One stat of a file nginx has just opened the
// sibling of; nothing is read.
import fs from 'fs';

function fileSize(r) {
    if (r.headersOut['Content-Encoding'] !== 'gzip') return;
    try {
        r.headersOut['X-File-Size'] = String(fs.statSync(r.variables.request_filename).size);
    } catch (e) {
        // No plain file beside the .gz: leave the header out, and the loader
        // falls back to Content-Length.
    }
}

export default { fileSize };
