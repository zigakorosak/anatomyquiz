// One SkeletonViewer for the whole app: created and loaded on first use, then
// moved between screens. Saves re-decoding the model and avoids piling up
// WebGL contexts (browsers cap them).

import { SkeletonViewer } from "./SkeletonViewer.js";
import { MODEL_URL } from "../core/dataset.js";

let viewer = null;
let ready = null;

export async function getViewer(container) {
  if (!viewer) {
    viewer = new SkeletonViewer(container, { modelUrl: MODEL_URL });
    ready = viewer.load();
  } else {
    viewer.attach(container);
  }
  await ready;
  // Test hook for browser-driven checks (scratch Playwright scripts); not in
  // production builds.
  if (import.meta.env.DEV) window.__anatomy = { viewer };
  viewer.reset();
  return viewer;
}
