/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Seeds the demo engine so every page load deals the same rounds. */
  readonly VITE_ENGINE_SEED?: string;
}
