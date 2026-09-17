/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API origin for static-host builds (GitHub Pages mirror). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
