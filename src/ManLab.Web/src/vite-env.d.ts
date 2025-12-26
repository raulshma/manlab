/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_SERVER_BASE_URL?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
