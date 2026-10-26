package io.bfstats.sidecar

import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.curl.Curl

internal actual val httpEngine: HttpClientEngineFactory<*> = Curl
