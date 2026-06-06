import {
  LaylaBridgeUnavailableError,
  LaylaError,
} from "./layla";

export function formatLaylaConnectionError(error: unknown) {
  if (error instanceof LaylaBridgeUnavailableError) {
    return "Layla bridge unavailable. Open this mini-app inside Layla so the WebView bridge can connect.";
  }

  if (error instanceof LaylaError) {
    return `Layla API connection failed: ${error.message}`;
  }

  return "Layla API connection failed. Check the Layla host connection and try again.";
}
