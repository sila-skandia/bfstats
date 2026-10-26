package io.bfstats.sidecar

import java.util.zip.GZIPInputStream

actual fun gunzip(b: ByteArray): ByteArray = GZIPInputStream(b.inputStream()).use { it.readBytes() }
