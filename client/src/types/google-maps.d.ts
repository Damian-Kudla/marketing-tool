/// <reference types="@types/google.maps" />

declare global {
  interface Window {
    google: typeof google;
    __googleMapsScriptLoading?: boolean;
  }
}

export {};
