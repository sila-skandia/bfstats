/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly PROMETHEUS_URL?: string
    readonly VITE_DISCORD_CLIENT_ID?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare global {
    interface Window {
        /**
         * In-flight live-server feed started by the inline script in index.html
         * on the landing route. Consumed (and cleared) by `fetchAllServers`.
         */
        __bfLiveServersPreload?: Promise<{ servers: import('./types/server').ServerSummary[]; lastUpdated?: string } | null>
    }
}

declare module 'vue' {
    interface ComponentCustomProperties {
        $pn: (name: string | null | undefined) => string
    }
}

export {}
