/// <reference types="vite/client" />

import type { ViewerEngine } from "./viewer/ViewerEngine";

declare global {
  interface Window {
    avatar?: ViewerEngine;
  }
}

export {};
