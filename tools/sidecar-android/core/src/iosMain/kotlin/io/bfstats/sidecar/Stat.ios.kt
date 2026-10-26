package io.bfstats.sidecar

// An iPhone has no game install, the only thing whose files are fingerprinted
// by time (TemplateTable.fingerprint); unknown, so such a cache never matches.
actual fun fileMtimeMs(path: String): Long? = null
