// Persistent, app-wide preferences (as opposed to per-game choices made in
// the wizard). Backed by localStorage; falls back to defaults when storage
// is unavailable (private browsing) or holds unexpected data. Same shape
// as GeoQuiz's core/settings.js.

const STORAGE_KEY = "anatomy-quiz-settings";

const defaults = {
  // Keep the player's own camera view between rounds (GeoQuiz's keepZoom).
  keepView: true,
  // After confirming, glide the camera to the correct answer (and a wrong
  // pick). Off: the camera stays put; the answer is still coloured.
  zoomToAnswer: true,
};

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaults, ...stored };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — the setting just won't survive a reload.
  }
}
