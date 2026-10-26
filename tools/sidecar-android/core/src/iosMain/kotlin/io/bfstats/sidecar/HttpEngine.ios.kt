package io.bfstats.sidecar

import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.darwin.Darwin

internal actual val httpEngine: HttpClientEngineFactory<*> = Darwin
