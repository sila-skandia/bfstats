/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly PROMETHEUS_URL?: string
    readonly VITE_DISCORD_CLIENT_ID?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare module 'vue' {
    interface ComponentCustomProperties {
        $pn: (name: string | null | undefined) => string
    }
}

export {}
