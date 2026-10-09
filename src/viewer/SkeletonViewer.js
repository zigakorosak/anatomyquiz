// Reusable 3D skeleton view: loads the GLB, orbit/zoom/pan, click and hover
// picking, per-item visual states, region muting and camera framing.
//
// Items are addressed by mesh id (the Blender object name, e.g. "Femur.l").
// A quiz item can own several mesh ids (a merged left/right pair); callers pass
// arrays of mesh ids and get mesh ids back from picks.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACO_GLTF_CONFIG, DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

// Base colors per tissue material, as exported by scripts/export-skeleton.py.
const TISSUE_COLORS = {
  bone: 0xe8dcc4,
  cartilage: 0xbcd3de,
  tooth: 0xf7f4ea,
};

// Muscle-attachment patches (public/data/insertions.glb): amber, apart from
// every state colour below. Drawn with a polygon offset so they win the
// depth test against the bone surface they lie on (they're 1 mm shells on
// the full-resolution bone, and the bones are decimated).
const PATCH_COLOR = 0xe0a83a;

// Muscles (public/data/muscles.glb): a muted brick red, darker than the
// "wrong" state's pink-red, and their tendons a pale silver, apart from the
// bones' warm ivory.
const MUSCLE_COLORS = {
  muscle: 0x9e4a42,
  tendon: 0xc9cdc6,
};

// Plane cut (setCut): one clipping plane shared by every material. Cut
// bones show a flat "cap" where they're open: a back-face copy of the mesh
// in a darker shade of its colour. Caps are always drawn (behind the front
// faces they cost a depth test, nothing more), so the inside of any bone
// looks solid however you see it: through a cut, or with the camera inside.
const CAP_SHADE = 0.72;
// Plane caps draw after the bones (opaque, renderOrder 0), before the ghosts,
// by kind in this order: where structures overlap, the first cap wins.
const PLANE_CAP_ORDER = 1000;
const CAP_PRIORITY = ["bone", "patch", "muscle"];
// The cut's plane itself, drawn faintly so you can see where it is.
const CUT_PLANE_COLOR = 0x4f8cff; // --accent
const CUT_PLANE_OPACITY = 0.08;
const CUT_PLANE_MARGIN = 1.1; // × the region's extent
const CUT_AXES = {
  sagittal: new THREE.Vector3(1, 0, 0), // + = the body's left
  coronal: new THREE.Vector3(0, 0, 1), // + = front
  transverse: new THREE.Vector3(0, 1, 0), // + = up
};

// Visual states, in GeoQuiz's palette (style.css --accent / --correct /
// --wrong): the highlighted question and a selection are the accent blue,
// as a highlighted or selected country is there; hover a lighter blue.
// `null` is the plain look.
const STATE_COLORS = {
  hover: 0x8fb4ff,
  selected: 0x4f8cff,
  target: 0x4f8cff,
  correct: 0x34c77b,
  wrong: 0xe0546b,
};

// Bones outside the played region: very pale and see-through.
const MUTED_COLOR = 0xf4f1ea;
const MUTED_OPACITY = 0.07;

// Muted bones draw in two passes, so every pixel gets exactly one faint
// layer, the nearest muted surface, whatever the shape (see _apply):
// first all their depths (no colour), then their colour where depth is
// equal. Both run after the opaque pass, so playable bones show through.
const GHOST_DEPTH_ORDER = 1;
const GHOST_COLOR_ORDER = 2;

// Layer peeling (computeLayers): the set is rendered from these directions
// (6 axes + 8 corners), depth-peeled up to PEEL_PASSES deep, at
// PEEL_SIZE² px per view.
const PEEL_DIRECTIONS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
].map((d) => new THREE.Vector3(...d).normalize());
const PEEL_SIZE = 256;
const PEEL_PASSES = 8;
// Each peel round splits the remaining meshes into outer/inner at the
// natural break in their exposures (Otsu's two-group split), but only when
// the inner group is genuinely hidden: its mean exposure below
// PEEL_INNER_MAX, and clearly apart from the outer group (means at least
// PEEL_MIN_SEPARATION apart). Otherwise what's left is one layer. No fixed
// exposure threshold works everywhere (the skull's break is near 0.25, the
// trunk's ribs vs vertebrae near 0.5). Calibrated per round on skull, trunk,
// hand, foot, teeth and the whole skeleton: real inner layers measured
// 0.12–0.44; the spurious splits (a vertebral column peeling two vertebrae
// at a time from its ends) had inner groups at 0.50–0.52, already easy
// to click. See DESIGN.md "Layers slider".
const PEEL_MIN_SEPARATION = 0.15;
const PEEL_INNER_MAX = 0.45;
// Every layer must hold at least this many different structures (left and
// right count once); smaller ones merge into a neighbour (see
// mergeSmallLayers). A layer of one or two bones — the ethmoid alone at
// the end of the skull, two cuneiforms at the end of the foot — hid
// nothing worth hiding: they were already easy to click a step earlier.
const PEEL_MIN_STRUCTURES = 4;

/**
 * Merges every layer with fewer than PEEL_MIN_STRUCTURES distinct structures
 * into the next layer inward, or outward if it's the innermost, then
 * renumbers 0..n-1. levels: Map(meshId -> layer).
 */
function mergeSmallLayers(levels, count) {
  const structure = (id) => id.replace(/\.[lr]$/, "");
  const layers = Array.from({ length: count }, () => []);
  for (const [id, l] of levels) layers[l].push(id);
  const size = (ids) => new Set(ids.map(structure)).size;
  let merged = layers.filter((ids) => ids.length);
  for (let i = 0; i < merged.length - 1; ) {
    if (size(merged[i]) < PEEL_MIN_STRUCTURES) {
      merged[i + 1] = [...merged[i], ...merged[i + 1]];
      merged.splice(i, 1);
    } else i++;
  }
  while (merged.length > 1 && size(merged.at(-1)) < PEEL_MIN_STRUCTURES) {
    const last = merged.pop();
    merged[merged.length - 1].push(...last);
  }
  const out = new Map();
  merged.forEach((ids, l) => ids.forEach((id) => out.set(id, l)));
  return { levels: out, count: merged.length };
}

/** Otsu's split of `values`: the cut minimising within-group variance. */
function naturalBreak(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return null;
  const prefix = [0];
  const prefixSq = [0];
  for (const x of v) {
    prefix.push(prefix.at(-1) + x);
    prefixSq.push(prefixSq.at(-1) + x * x);
  }
  let best = null;
  for (let i = 1; i < n; i++) {
    const lowMean = prefix[i] / i;
    const highMean = (prefix[n] - prefix[i]) / (n - i);
    const within =
      prefixSq[i] - i * lowMean * lowMean + (prefixSq[n] - prefixSq[i]) - (n - i) * highMean * highMean;
    if (!best || within < best.within) best = { within, cut: v[i], lowMean, highMean };
  }
  return best;
}

// Draws each mesh in a flat id colour; with `peel` on, drops every fragment
// at or in front of the previous pass's depth, so pass k shows the k-th
// surface along each pixel's ray.
const PEEL_VERTEX = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const PEEL_FRAGMENT = /* glsl */ `
  uniform vec3 idColor;
  uniform sampler2D prevDepth;
  uniform float peel;
  uniform vec2 size;
  void main() {
    if (peel > 0.5 && gl_FragCoord.z <= texture2D(prevDepth, gl_FragCoord.xy / size).r + 2e-5) discard;
    gl_FragColor = vec4(idColor, 1.0);
  }
`;

// A press that moves further than this (px) is a rotate/pan drag, not a
// click. Must be > 0: GeoQuiz lost clicks to d3-zoom's default of 0, since
// real mouse presses drift a pixel or two.
const CLICK_SLOP = 6;

// Click assist for tiny bones (ossicles, distal phalanges): when a click hits
// nothing, look outward in rings for the nearest hit, up to this radius (px).
// Only on a miss, so a direct hit on a big neighbour always wins.
const ASSIST_RADIUS = { mouse: 10, touch: 20, pen: 12 };
const ASSIST_STEP = 3;
const ASSIST_ANGLES = 12;

/**
 * Closes the seams between a structure's parts (a bone and its articular
 * cartilage, a muscle and its tendon: one material each, so separate glTF
 * primitives). Draco quantizes each primitive's positions on its own grid,
 * so vertices shared across the seam come out up to ~25 µm apart: hairline
 * cracks that break the closed-surface counting the cut caps rely on.
 * Snaps each open-edge vertex of a later part onto the nearest open-edge
 * vertex of an earlier one within WELD_DISTANCE.
 */
const WELD_DISTANCE = 0.00006;
function weldSeams(list) {
  const cell = WELD_DISTANCE;
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const boundary = (geometry) => {
    const index = geometry.index;
    if (!index) return [];
    const count = new Map();
    for (let t = 0; t < index.count; t += 3)
      for (let j = 0; j < 3; j++) {
        const a = index.getX(t + j), b = index.getX(t + ((j + 1) % 3));
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    const verts = new Set();
    for (const [k, c] of count) if (c === 1) for (const v of k.split("_")) verts.add(Number(v));
    return [...verts];
  };
  const grid = new Map(); // cell -> [[x, y, z]]
  list.forEach((m, i) => {
    const pos = m.geometry.attributes.position;
    let moved = false;
    for (const v of boundary(m.geometry)) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (i > 0) {
        let best = null, bestD = WELD_DISTANCE * WELD_DISTANCE;
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              for (const p of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
                const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
                if (d < bestD) (bestD = d), (best = p);
              }
        if (best) {
          pos.setXYZ(v, best[0], best[1], best[2]);
          moved = true;
          continue;
        }
      }
      const k = key(x, y, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([x, y, z]);
    }
    if (moved) {
      pos.needsUpdate = true;
      m.geometry.computeBoundingBox();
      m.geometry.computeBoundingSphere();
    }
  });
}

export class SkeletonViewer {
  constructor(container, { modelUrl }) {
    this.container = container;
    this.modelUrl = modelUrl;

    this.meshes = new Map(); // mesh id -> [THREE.Mesh] (one per material primitive)
    // Models loaded on demand beside the skeleton, by kind: attachment
    // patches and muscles. Each starts hidden (see showModel).
    this.extras = {
      patch: { ids: [], shown: false, ready: null },
      muscle: { ids: [], shown: false, ready: null },
    };
    this.playable = null; // Set of mesh ids, or null = everything
    // Mesh ids drawn solid but never clickable or hoverable: the bones under
    // muscle attachments. They still block clicks on what's behind them.
    this.backdrop = new Set();
    // Mesh ids not drawn at all (Explore's "Off" subjects).
    this.hidden = new Set();
    this.states = new Map(); // mesh id -> state name
    this.hoverIds = [];
    this.hoverGroup = null; // (meshId) => mesh ids to hover together
    this.pickHandler = null;
    this.hoverHandler = null;
    this.xrays = [];
    this.anim = null;
    this.dirty = true;

    // Transparent, so the stage's CSS background shows through.
    // stencil: for the cut caps (_updatePlaneCaps).
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "viewer-canvas";
    container.append(this.renderer.domElement);

    // The plane cut: every material shares this array, holding the plane
    // while a cut is on and nothing otherwise (see setCut).
    this.renderer.localClippingEnabled = true;
    this.clipPlanes = [];
    this.cutPlane = new THREE.Plane();

    // Depth-only copies of muted meshes (see _apply): one shared material.
    this.ghostDepthMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      transparent: true, // drawn after the opaque pass, so playable bones behind ghosts still show
      clippingPlanes: this.clipPlanes,
    });

    this.scene = new THREE.Scene();
    // near 2 mm (was 1 cm): close-up views clip less. 2 mm..20 m keeps
    // depth precision ample for the whole skeleton.
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.002, 20);
    this.camera.position.set(0, 0.9, 4);

    // Lights ride along with the camera so the side being looked at is lit.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.5, 2);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 8;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.controls.addEventListener("start", () => this._cancelAnimation());

    this.raycaster = new THREE.Raycaster();
    this._bindPointer();

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(container);
    this._resize();

    this._loop = this._loop.bind(this);
    this.frameId = requestAnimationFrame(this._loop);
  }

  async load() {
    this.boneIds = await this._loadModel(this.modelUrl, "bone");
    this.bounds = new THREE.Box3();
    this.bounds.copy(this.boxOf(this.boneIds));
    this.frame(null, { animate: false });
    this._applyAll();
  }

  /**
   * Loads an extra model ("patch" or "muscle"; once, later calls return
   * the same promise). It starts hidden: see showModel().
   */
  loadModel(kind, url) {
    const extra = this.extras[kind];
    extra.ready ??= this._loadModel(url, kind).then((ids) => {
      extra.ids = ids;
      this._updateVisibility();
      this._applyAll();
    });
    return extra.ready;
  }

  /** An extra model is only on screen while its subject is in use. */
  showModel(kind, shown) {
    this.extras[kind].shown = shown;
    this._updateVisibility();
  }

  loadInsertions(url) {
    return this.loadModel("patch", url);
  }

  showPatches(shown) {
    this.showModel("patch", shown);
  }

  loadMuscles(url) {
    return this.loadModel("muscle", url);
  }

  showMuscles(shown) {
    this.showModel("muscle", shown);
  }

  /** Muscle-attachment patch mesh ids (empty until loaded). */
  get patchIds() {
    return this.extras.patch.ids;
  }

  /** Muscle mesh ids (empty until loaded). */
  get muscleIds() {
    return this.extras.muscle.ids;
  }

  /** Meshes not drawn at all: not clickable, no ghost, no cap. */
  setHidden(ids) {
    this.hidden = new Set(ids ?? []);
    this._updateVisibility();
    this._setHover(null);
  }

  _updateVisibility() {
    for (const [id, list] of this.meshes) {
      const kind = list[0].userData.kind;
      const shown = !this.hidden.has(id) && (kind === "bone" || this.extras[kind].shown);
      for (const m of list) m.visible = shown;
    }
    if (this.clipPlanes) this._updatePlaneCaps();
    this.dirty = true;
  }

  /** Bones drawn solid but not clickable (see this.backdrop). */
  setBackdrop(ids) {
    this.backdrop = new Set(ids ?? []);
    this._applyAll();
  }

  async _loadModel(url, kind) {
    const draco = new DRACOLoader();
    // three's own glTF decoder build, bundled by Vite (hashed URLs, no copy step).
    draco.setDecoderPath(DRACO_GLTF_CONFIG);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(url);
    draco.dispose();

    // GLTFLoader sanitizes node names ("Femur.l" -> "Femurl"), so recover the
    // original names from the glTF JSON via the parser's associations.
    // Collect first, set up after: setup adds a child mesh (the ghost depth
    // copy) to each mesh, and traverse() would walk into those new children
    // and recurse forever (it did — a stack overflow on load).
    const { parser } = gltf;
    const nodes = [];
    gltf.scene.traverse((obj) => {
      const assoc = parser.associations.get(obj);
      if (assoc?.nodes === undefined) return;
      const meshes = [];
      obj.traverse((m) => m.isMesh && meshes.push(m));
      if (meshes.length) nodes.push([parser.json.nodes[assoc.nodes].name, meshes]);
    });
    for (const [id, meshes] of nodes) {
      const list = [];
      for (const m of meshes) {
        const material = m.material?.name;
        const base =
          kind === "patch"
            ? PATCH_COLOR
            : kind === "muscle"
              ? (MUSCLE_COLORS[material] ?? MUSCLE_COLORS.muscle)
              : (TISSUE_COLORS[material] ?? TISSUE_COLORS.bone);
        m.material = new THREE.MeshStandardMaterial({
          color: base,
          roughness: 0.75,
          metalness: 0,
          clippingPlanes: this.clipPlanes,
          ...(kind === "patch" ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 } : {}),
        });
        m.userData.meshId = id;
        m.userData.kind = kind;
        m.userData.baseColor = base;
        // Depth pre-pass for when this mesh is muted (see _apply).
        const depth = new THREE.Mesh(m.geometry, this.ghostDepthMaterial);
        depth.renderOrder = GHOST_DEPTH_ORDER;
        depth.visible = false;
        depth.raycast = () => {};
        m.add(depth);
        m.userData.ghostDepth = depth;
        // Cut cap (see CAP_SHADE), for bones and attachment patches alike.
        // It fills the cross-section only because every mesh is exported
        // closed with outward faces (export-models.py seal()).
        {
          const cap = new THREE.Mesh(m.geometry, this._capMaterial());
          cap.visible = false;
          cap.raycast = () => {};
          m.add(cap);
          m.userData.cap = cap;
        }
        list.push(m);
      }
      if (list.length > 1) weldSeams(list);
      this.meshes.set(id, list);
    }
    this.scene.add(gltf.scene);
    this.root ??= gltf.scene;
    return nodes.map(([id]) => id);
  }

  /** Moves the viewer's canvas into another container (screens share one viewer). */
  attach(container) {
    this.resizeObserver.unobserve(this.container);
    this.container = container;
    container.append(this.renderer.domElement);
    this.resizeObserver.observe(container);
    this._resize();
  }

  /** Clears everything a screen may have set, keeping the camera where it is. */
  /**
   * Cuts the model with a plane, hiding everything on one side.
   * cut: { axis: "sagittal" | "coronal" | "transverse", flip, t, box } —
   * the plane is perpendicular to the axis, at fraction t (0..1) of the way
   * across `box` (a THREE.Box3; the region in play). Unflipped it keeps the
   * left / front / upper side. null turns the cut off.
   */
  setCut(cut) {
    if (!cut) {
      this.clipPlanes.length = 0;
    } else {
      const n = CUT_AXES[cut.axis].clone().multiplyScalar(cut.flip ? -1 : 1);
      const axis = CUT_AXES[cut.axis];
      const lo = cut.box.min.dot(axis);
      const hi = cut.box.max.dot(axis);
      const point = cut.box.getCenter(new THREE.Vector3());
      // Move the box centre along the axis to the slider's position.
      point.addScaledVector(axis, lo + cut.t * (hi - lo) - point.dot(axis));
      this.cutPlane.setFromNormalAndCoplanarPoint(n, point);
      if (!this.clipPlanes.length) this.clipPlanes.push(this.cutPlane);
      this._showCutPlane(axis, point, cut.box);
    }
    if (this.cutMarker) this.cutMarker.visible = Boolean(cut);
    this._applyAll();
  }

  /**
   * The faint plane through the cut: a quad spanning the region's other two
   * axes, at `point`, facing along `axis`. Not clipped, not clickable,
   * drawn after the bones without writing depth.
   */
  _showCutPlane(axis, point, box) {
    if (!this.cutMarker) {
      this.cutMarker = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: CUT_PLANE_COLOR,
          transparent: true,
          opacity: CUT_PLANE_OPACITY,
          side: THREE.DoubleSide,
          depthWrite: false,
          // Pushed a hair behind the plane: it lies exactly where the cut
          // caps are, and at equal depth it z-fought with them into faint
          // stripes across every cut face. Now the caps always win and the
          // marker shows only where nothing is cut.
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 4,
        }),
      );
      this.cutMarker.renderOrder = 5; // after the ghosts, before the x-ray
      this.cutMarker.raycast = () => {};
      this.scene.add(this.cutMarker);
    }
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(CUT_PLANE_MARGIN);
    // PlaneGeometry lies in x/y facing +z; turn it to face along the axis
    // and stretch it over the box's extent in the two remaining axes.
    const m = this.cutMarker;
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    if (axis.x) m.scale.set(size.z, size.y, 1); // sagittal: plane in z/y
    else if (axis.y) m.scale.set(size.x, size.z, 1); // transverse: plane in x/z
    else m.scale.set(size.x, size.y, 1); // coronal: plane in x/y
    m.position.copy(point);
  }

  reset() {
    this.clipPlanes.length = 0;
    if (this.cutMarker) this.cutMarker.visible = false;
    this.peelLevels = null;
    this.peelDepth = 0;
    this.backdrop = new Set();
    this.hidden = new Set();
    for (const extra of Object.values(this.extras)) extra.shown = false;
    this._updateVisibility();
    this.pickHandler = null;
    this.hoverHandler = null;
    this.hoverGroup = null;
    this.hoverIds = [];
    this.states.clear();
    this.playable = null;
    this.setXray([]);
    this.renderer.domElement.style.cursor = "";
    this._applyAll();
  }

  /** Bone mesh ids (not the attachment patches). */
  get meshIds() {
    return this.boneIds ?? [];
  }

  /** Called with a mesh id (or null for empty space) on a click that isn't a drag. */
  onPick(handler) {
    this.pickHandler = handler;
  }

  /** Called with a mesh id or null when the hovered item changes (mouse only). */
  onHover(handler) {
    this.hoverHandler = handler;
  }

  /**
   * Which mesh ids light up together when one of them is hovered. Hover is
   * only active while a hover group or hover handler is set, so bones don't
   * light up in modes where clicking them does nothing.
   */
  setHoverGroup(fn) {
    this.hoverGroup = fn;
    if (!this._hoverEnabled()) this._setHover(null);
  }

  /** Mesh ids that are clickable and fully drawn; the rest are muted. null = all. */
  setPlayable(ids) {
    this.playable = ids ? new Set(ids) : null;
    this._applyAll();
  }

  setState(ids, state) {
    for (const id of ids) {
      if (state) this.states.set(id, state);
      else this.states.delete(id);
      this._apply(id);
    }
    this._updatePlaneCaps(); // cap colours, and states un-ghost meshes
  }

  clearStates() {
    const ids = [...this.states.keys()];
    this.states.clear();
    for (const id of ids) this._apply(id);
    this.setXray([]);
    this._updatePlaneCaps();
  }

  /**
   * Draws a see-through copy of these meshes on top of everything, so a
   * highlighted target stays visible behind other bones.
   */
  setXray(ids, color = STATE_COLORS.target) {
    for (const x of this.xrays) {
      x.removeFromParent();
      x.material.dispose();
    }
    this.xrays = [];
    for (const id of ids) {
      for (const m of this.meshes.get(id) ?? []) {
        const x = new THREE.Mesh(
          m.geometry,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.35,
            depthTest: false,
            depthWrite: false,
            clippingPlanes: this.clipPlanes,
          }),
        );
        x.renderOrder = 10;
        x.raycast = () => {};
        m.add(x);
        this.xrays.push(x);
      }
    }
    this.dirty = true;
  }

  /**
   * Points the camera at a set of meshes (null = whole model).
   * direction: "keep" (current view direction), "outward" (from the body's
   * vertical axis toward the target, so a vertebra is seen from behind and the
   * sternum from the front), or a THREE.Vector3.
   */
  frame(ids, { animate = true, direction = "keep", padding = 1.08, minRadius = 0 } = {}) {
    const box = ids?.length ? this.boxOf(ids) : this.bounds;
    if (!box || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    let dir;
    if (direction === "outward") {
      const axis = this.bounds.getCenter(new THREE.Vector3());
      dir = new THREE.Vector3(sphere.center.x - axis.x, 0, sphere.center.z - axis.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      dir.y = 0.15;
      dir.normalize();
    } else if (direction instanceof THREE.Vector3) {
      dir = direction.clone().normalize();
    } else {
      dir = this.camera.position.clone().sub(this.controls.target).normalize();
    }

    // Fit the box as seen from `dir`: project its corners onto the camera's
    // right/up axes, so a tall, narrow skeleton fills the height instead of
    // being fitted like a sphere. minRadius keeps some context around tiny
    // targets.
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0); // looking straight up/down
    right.normalize();
    const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    let halfW = minRadius;
    let halfH = minRadius;
    let halfD = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const c = new THREE.Vector3(x, y, z).sub(sphere.center);
          halfW = Math.max(halfW, Math.abs(c.dot(right)));
          halfH = Math.max(halfH, Math.abs(c.dot(camUp)));
          halfD = Math.max(halfD, Math.abs(c.dot(dir)));
        }
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;
    const dist = Math.max(halfH / tanV, halfW / tanH) * padding + halfD;
    const toTarget = sphere.center.clone();
    const toPos = sphere.center.clone().addScaledVector(dir, dist);

    if (!animate) {
      this.anim = null; // or a glide still running would carry on over this
      this.controls.target.copy(toTarget);
      this.camera.position.copy(toPos);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.anim = {
      t0: performance.now(),
      ms: 450,
      fromTarget: this.controls.target.clone(),
      fromPos: this.camera.position.clone(),
      toTarget,
      toPos,
    };
  }

  /** Current camera placement, for setView() to return to later. */
  getView() {
    return { position: this.camera.position.clone(), target: this.controls.target.clone() };
  }

  setView(view, { animate = true } = {}) {
    if (!animate) {
      this.anim = null;
      this.camera.position.copy(view.position);
      this.controls.target.copy(view.target);
      this.controls.update();
      this.dirty = true;
      return;
    }
    this.anim = {
      t0: performance.now(),
      ms: 450,
      fromTarget: this.controls.target.clone(),
      fromPos: this.camera.position.clone(),
      toTarget: view.target.clone(),
      toPos: view.position.clone(),
    };
  }

  /** The front view direction (+Z in glTF's Y-up space). */
  static get FRONT() {
    return new THREE.Vector3(0, 0.08, 1);
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this._unbindPointer();
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /**
   * Screen point (client px) where a click would hit `id` — a projected vertex
   * of the mesh that the pick raycast confirms. For tests (see
   * window.__anatomy in shared.js); null if the mesh isn't hittable in view.
   */
  findClickPoint(id) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    for (const m of this.meshes.get(id) ?? []) {
      const pos = m.geometry.attributes.position;
      const v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 200));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(this.camera);
        if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) continue;
        const x = rect.left + ((v.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - v.y) / 2) * rect.height;
        // Nudge inward a pixel in each direction; accept only stable hits.
        const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(
          ([dx, dy]) => this._pickAt(x + dx, y + dy) === id,
        );
        if (ok) return { x, y };
      }
    }
    return null;
  }

  // --- internals ---

  /**
   * How deep each mesh sits, as a layer number (0 = outermost), for the
   * layers slider. Peels the set like an onion, in rounds: each round
   * measures every remaining mesh's exposure (peelExposure) and takes off
   * the clearly more exposed group (naturalBreak); what's left is measured
   * again without them. When the rest is all alike, it's the last layer.
   * Cached per id set.
   */
  computeLayers(ids) {
    const key = [...ids].sort().join("|");
    this.layerCache ??= new Map();
    if (this.layerCache.has(key)) return this.layerCache.get(key);

    let remaining = [...ids].filter((id) => this.meshes.has(id));
    const levels = new Map();
    let level = 0;
    while (remaining.length) {
      const exposure = this.peelExposure(remaining);
      const split = naturalBreak(exposure.values());
      const layered =
        split && split.lowMean < PEEL_INNER_MAX && split.highMean - split.lowMean >= PEEL_MIN_SEPARATION;
      const outer = layered ? remaining.filter((id) => exposure.get(id) >= split.cut) : remaining;
      for (const id of outer) levels.set(id, level);
      remaining = remaining.filter((id) => !levels.has(id));
      level++;
    }
    const result = mergeSmallLayers(levels, level);
    this.layerCache.set(key, result);
    return result;
  }

  /**
   * Exposure of each mesh in `list`: of all its surface seen from 14
   * directions around the set (front faces only, every depth layer, via
   * depth peeling), the share that's the first surface on its pixel, i.e.
   * visible from outside. A skull-vault bone is about half (its outside
   * from one side, its inside across the cavity from the other); the
   * ethmoid, behind the face from every side, close to none. Measuring the
   * median layer instead (an earlier attempt) put hollow shapes like the
   * vault a layer too deep, because of that inside view.
   */
  peelExposure(list) {
    const size = PEEL_SIZE;
    const makeTarget = () => {
      const rt = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      rt.depthTexture = new THREE.DepthTexture(size, size);
      return rt;
    };
    const targets = [makeTarget(), makeTarget()];
    const shared = {
      prevDepth: { value: null },
      peel: { value: 0 },
      size: { value: new THREE.Vector2(size, size) },
    };
    const scene = new THREE.Scene();
    const materials = [];
    list.forEach((id, i) => {
      const n = i + 1; // 0 = background
      const material = new THREE.ShaderMaterial({
        vertexShader: PEEL_VERTEX,
        fragmentShader: PEEL_FRAGMENT,
        uniforms: { ...shared, idColor: { value: new THREE.Vector3((n & 255) / 255, ((n >> 8) & 255) / 255, 0) } },
      });
      materials.push(material);
      for (const m of this.meshes.get(id)) {
        const copy = new THREE.Mesh(m.geometry, material);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(m.matrixWorld);
        scene.add(copy);
      }
    });

    const sphere = this.boxOf(list).getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-3);
    const camera = new THREE.OrthographicCamera(-r, r, r, -r, r * 0.5, r * 3.5);
    const first = new Array(list.length).fill(0);
    const total = new Array(list.length).fill(0);
    const pixels = new Uint8Array(size * size * 4);

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const dir of PEEL_DIRECTIONS) {
      camera.position.copy(sphere.center).addScaledVector(dir, r * 2);
      camera.up.set(0, Math.abs(dir.y) > 0.99 ? 0 : 1, Math.abs(dir.y) > 0.99 ? 1 : 0);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld();
      for (let pass = 0; pass < PEEL_PASSES; pass++) {
        const target = targets[pass % 2];
        shared.peel.value = pass > 0 ? 1 : 0;
        shared.prevDepth.value = pass > 0 ? targets[(pass + 1) % 2].depthTexture : null;
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        let any = false;
        for (let p = 0; p < pixels.length; p += 4) {
          const n = pixels[p] + (pixels[p + 1] << 8);
          if (!n) continue;
          any = true;
          total[n - 1]++;
          if (pass === 0) first[n - 1]++;
        }
        if (!any) break;
      }
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    for (const t of targets) {
      t.depthTexture.dispose();
      t.dispose();
    }
    for (const m of materials) m.dispose();

    return new Map(list.map((id, i) => [id, total[i] ? first[i] / total[i] : 0]));
  }

  /**
   * Hides the outer `depth` layers of `levels` (from computeLayers): they
   * draw as muted ghosts and can't be clicked or hovered, so what's inside
   * can. 0 shows everything. A mesh with a state (target, correct, …)
   * still draws in colour.
   */
  setPeel(levels, depth) {
    this.peelLevels = levels;
    this.peelDepth = depth;
    this._setHover(null);
    this._applyAll();
  }

  /**
   * How to look at an attachment face-on: the meshes of `item`'s first side
   * (its other side still shows through the x-ray), and the direction from
   * the bone(s) under them out to the patch. For frame(ids, { direction }).
   */
  faceOn(item) {
    const side = item.members.filter((m) => m.side === item.members[0].side);
    const ids = side.map((m) => m.id);
    const center = (list) => this.boxOf(list).getCenter(new THREE.Vector3());
    const dir = center(ids).sub(center([...new Set(side.map((m) => m.host))]));
    return { ids, direction: dir.lengthSq() > 1e-10 ? dir.normalize() : "outward" };
  }

  /**
   * The always-on back-face cap: the mesh's inside in a flat colour, so a
   * bone never looks hollow, e.g. with the camera inside it. Cut faces get
   * a proper cap on the plane on top of this (_updatePlaneCaps).
   */
  _capMaterial() {
    return new THREE.MeshBasicMaterial({ side: THREE.BackSide, clippingPlanes: this.clipPlanes });
  }

  /**
   * Caps the cut: for every solid structure the plane crosses, a flat quad
   * *on* the plane, drawn only where the plane passes through its inside
   * (stencil capping). So a cut face is solid even where another mesh lies
   * inside it: the costal cartilages' tips overlap into the sternum, and
   * with only back-face caps (the far inner wall) they showed through the
   * sternum's cut face. Per structure, in order (renderOrder), after the
   * bones:
   *   1. the back faces of all its parts +1, front faces −1 on the stencil's
   *      low 7 bits (no colour, no depth test, clipped), leaving them
   *      non-zero where the plane is inside. All parts count together: a
   *      muscle's tendon (or a bone's cartilage) is a separate part, open
   *      where it meets the rest, so counted alone it would miscount.
   *   2. the quad, where those bits aren't 0, depth-tested, in the cap
   *      colour. It sets the top bit ("capped") and clears the count.
   * Counting skips capped pixels, so where structures overlap (muscles
   * interpenetrate each other and the bones) the first cap drawn keeps the
   * pixel; separate quads at the same depth otherwise z-fought into
   * stripes. Caps go in priority order: bones, then attachment patches,
   * then muscles, each in model order, and cut picking prefers the same
   * order (_pickAt), so a click picks what's shown.
   * Only structures whose box the plane crosses get the passes.
   */
  _updatePlaneCaps() {
    const cutting = this.clipPlanes.length > 0;
    let order = 0;
    this.capPriority = new Map();
    for (const kind of CAP_PRIORITY) {
      for (const [id, list] of this.meshes) {
        if (list[0].userData.kind !== kind) continue;
        const solid = list[0].visible && !this._isMutedNow(id);
        let pc = list[0].userData.planeCap;
        const box = this._geometryBox(list);
        const needed = cutting && solid && this.cutPlane.intersectsBox(box);
        if (!needed) {
          if (pc) pc.visible = false;
          continue;
        }
        pc ??= this._makePlaneCap(list);
        pc.visible = true;
        this.capPriority.set(id, order);
        const quad = pc.userData.quad;
        for (const c of pc.userData.counters) c.renderOrder = PLANE_CAP_ORDER + 2 * order;
        quad.renderOrder = PLANE_CAP_ORDER + 2 * order + 1;
        order++;
        // The quad: on the plane, over the structure's box, facing along the normal.
        const c = box.getCenter(new THREE.Vector3());
        c.addScaledVector(this.cutPlane.normal, -this.cutPlane.distanceToPoint(c));
        quad.position.copy(c);
        quad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.cutPlane.normal);
        const size = box.getSize(new THREE.Vector3()).length() * 1.2;
        quad.scale.set(size, size, 1);
        quad.material.color.copy(list[0].material.color).multiplyScalar(CAP_SHADE);
      }
    }
    this.dirty = true;
  }

  /** Box of a structure's parts (geometry only; they're baked in world space). */
  _geometryBox(list) {
    const box = new THREE.Box3();
    for (const m of list) {
      m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox);
    }
    return box;
  }

  _makePlaneCap(list) {
    const counter = (geometry, side, op) => {
      const x = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          side,
          colorWrite: false,
          depthWrite: false,
          depthTest: false,
          clippingPlanes: this.clipPlanes,
          stencilWrite: true,
          // Only where no cap is drawn yet (top bit clear); count in the low bits.
          stencilFunc: THREE.EqualStencilFunc,
          stencilRef: 0,
          stencilFuncMask: 0x80,
          stencilWriteMask: 0x7f,
          stencilFail: THREE.KeepStencilOp,
          stencilZFail: op,
          stencilZPass: op,
        }),
      );
      x.raycast = () => {};
      return x;
    };
    this.capQuadGeometry ??= new THREE.PlaneGeometry(1, 1);
    const quad = new THREE.Mesh(
      this.capQuadGeometry,
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        stencilWrite: true,
        // Where the count (low bits) isn't 0: ref & mask = 0, so NotEqual.
        stencilRef: 0x80,
        stencilFuncMask: 0x7f,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilWriteMask: 0xff,
        stencilFail: THREE.KeepStencilOp,
        // Hidden behind something: just clear the count.
        stencilZFail: THREE.ZeroStencilOp,
        // Drawn: mark capped (0x80), count cleared.
        stencilZPass: THREE.ReplaceStencilOp,
      }),
    );
    quad.raycast = () => {};
    const counters = list.flatMap((m) => [
      counter(m.geometry, THREE.BackSide, THREE.IncrementWrapStencilOp),
      counter(m.geometry, THREE.FrontSide, THREE.DecrementWrapStencilOp),
    ]);
    const group = new THREE.Group();
    group.add(...counters, quad);
    group.userData = { counters, quad };
    // A child of the structure's first mesh, so hiding the structure hides
    // its cap too; meshes are baked in world space, so local = world.
    list[0].add(group);
    list[0].userData.planeCap = group;
    return group;
  }

  /** Muted (ghosted) right now, as _apply decides it. */
  _isMutedNow(id) {
    return !this._isSolid(id) && !this.states.has(id);
  }

  /**
   * World-space bounding box of these meshes: their own geometry only.
   * (Box3.expandByObject would include children, and the cut-cap quads are
   * deliberately oversized children: framing a capped bone zoomed far out.)
   */
  boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids)
      for (const m of this.meshes.get(id) ?? []) {
        m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
        m.updateWorldMatrix(true, false);
        box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
      }
    return box;
  }


  _hoverEnabled() {
    return Boolean(this.hoverGroup || this.hoverHandler);
  }

  /** Clickable and hoverable: in play and not peeled away. */
  _isPlayable(id) {
    return (!this.playable || this.playable.has(id)) && !this._isPeeled(id);
  }

  /** Drawn solid: playable, or a backdrop bone that isn't peeled. */
  _isSolid(id) {
    return this._isPlayable(id) || (this.backdrop.has(id) && !this._isPeeled(id));
  }

  _isPeeled(id) {
    return this.peelDepth > 0 && (this.peelLevels?.get(id) ?? Infinity) < this.peelDepth;
  }

  _applyAll() {
    for (const id of this.meshes.keys()) this._apply(id);
    this._updatePlaneCaps();
  }

  _apply(id) {
    const state = this.states.get(id) ?? (this.hoverIds.includes(id) ? "hover" : null);
    const muted = !this._isSolid(id) && !this.states.has(id);
    for (const m of this.meshes.get(id) ?? []) {
      const mat = m.material;
      if (muted) {
        // A pale, nearly flat ghost. Its colour pass doesn't write depth;
        // the depth-only copy (drawn earlier) has already written the
        // nearest muted surface, and the default LessEqual depth test lets
        // only that surface's colour through. Sorting by object instead
        // (an earlier attempt) still stacked layers wherever bones
        // interleave in depth: skull plates, jaw and teeth, a hand in front
        // of the hip.
        mat.color.setHex(MUTED_COLOR);
        mat.emissive.setHex(MUTED_COLOR);
        mat.emissiveIntensity = 0.6;
      } else {
        mat.color.setHex(state ? STATE_COLORS[state] : m.userData.baseColor);
        mat.emissive.setHex(state ? STATE_COLORS[state] : 0x000000);
        mat.emissiveIntensity = state ? 0.25 : 0;
      }
      // Switching transparent needs a shader rebuild: three compiles an
      // opaque material with alpha forced to 1, and keeps that program
      // until told otherwise. Without this, a bone first drawn solid (in
      // Explore, before peeling) stayed solid white when it should ghost.
      // Both variants stay in three's program cache, so this is cheap after
      // the first switch.
      if (mat.transparent !== muted) {
        mat.transparent = muted;
        mat.needsUpdate = true;
      }
      mat.opacity = muted ? MUTED_OPACITY : 1;
      mat.depthWrite = !muted;
      m.renderOrder = muted ? GHOST_COLOR_ORDER : 0;
      m.userData.ghostDepth.visible = muted;
      const cap = m.userData.cap;
      if (cap) {
        // Always on for solid meshes, not just while cutting: whenever the
        // inside of a bone shows (a cut, the camera inside or right against
        // a bone while orbiting a deep pivot), it reads as solid instead of
        // a hollow shell you can see through (user report: "I can see
        // inside the left clavicle").
        cap.visible = !muted;
        cap.material.color.copy(mat.color).multiplyScalar(CAP_SHADE);
      }
    }
    this.dirty = true;
  }

  _pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    // Only playable meshes are tested, so muted bones never block a click on
    // what's behind them (the ossicles inside the temporal bone, for one).
    // Backdrop bones are tested too, but only to block: a click that meets
    // a bone first picks nothing, so you can't select an attachment on the
    // far side of a femur by clicking through it.
    const targets = [];
    for (const [id, list] of this.meshes) {
      if (!list[0].visible) continue; // hidden patches
      if (this._isPlayable(id) || (this.backdrop.has(id) && !this._isPeeled(id))) targets.push(...list);
    }
    const cutting = this.clipPlanes.length > 0;
    // While cut: ignore hits on the hidden side, and test back faces too, so
    // a click on a bone's cut face (its inside) picks that bone.
    if (cutting) for (const m of targets) m.material.side = THREE.DoubleSide;
    const hits = this.raycaster.intersectObjects(targets, false);
    if (cutting) for (const m of targets) m.material.side = THREE.FrontSide;
    let hit = hits[0];
    if (cutting) {
      const kept = hits.filter((h) => this.cutPlane.distanceToPoint(h.point) >= 0);
      hit = kept[0];
      // Where the ray crosses the cut plane inside a mesh, that mesh's cap
      // is drawn on the plane, in front of anything inside it (see
      // _capMaterial). The ray is inside a mesh at the plane when its first
      // kept hit on that mesh is a back face, and it came from the hidden
      // side. Pick that mesh, as the picture shows.
      const fromHidden = this.cutPlane.distanceToPoint(this.raycaster.ray.origin) < 0;
      if (fromHidden) {
        // First kept hit per structure (any of its parts).
        const firstPerMesh = new Map();
        for (const h of kept) if (!firstPerMesh.has(h.object.userData.meshId)) firstPerMesh.set(h.object.userData.meshId, h);
        // Inside several (overlapping structures): the one whose cap is
        // drawn, i.e. first in cap priority.
        const rank = (h) => this.capPriority?.get(h.object.userData.meshId) ?? Infinity;
        const inside = [...firstPerMesh.values()]
          .filter((h) => h.face && h.face.normal.dot(this.raycaster.ray.direction) > 0)
          .sort((x, y) => rank(x) - rank(y))[0];
        if (inside) hit = inside;
      }
    }
    if (!hit) return null;
    const id = hit.object.userData.meshId;
    return this._isPlayable(id) ? id : null;
  }

  /** _pickAt, falling back to the nearest hit within `radius` px on a miss. */
  _pickNear(clientX, clientY, radius) {
    const direct = this._pickAt(clientX, clientY);
    if (direct || !radius) return direct;
    for (let r = ASSIST_STEP; r <= radius; r += ASSIST_STEP) {
      for (let a = 0; a < ASSIST_ANGLES; a++) {
        const t = (a / ASSIST_ANGLES) * Math.PI * 2;
        const id = this._pickAt(clientX + r * Math.cos(t), clientY + r * Math.sin(t));
        if (id) return id;
      }
    }
    return null;
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    const active = new Set(); // pointer ids currently pressed
    this._onDown = (e) => {
      // A primary pointer starts a fresh gesture, so a pointerup that never
      // arrived (canvas moved mid-press) can't leave a stale id that would
      // block clicks forever.
      if (e.isPrimary) active.clear();
      active.add(e.pointerId);
      if (active.size > 1) {
        // A second finger: this is a pinch/pan, never a click.
        if (down) down.moved = true;
        return;
      }
      // Only the primary button picks; right/middle drags pan in OrbitControls.
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, type: e.pointerType };
    };
    this._onMove = (e) => {
      if (down && down.id === e.pointerId) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) down.moved = true;
        return;
      }
      if (e.pointerType !== "mouse") return;
      this._pendingHover = { x: e.clientX, y: e.clientY };
    };
    this._onUp = (e) => {
      active.delete(e.pointerId);
      if (!down || down.id !== e.pointerId) return;
      const press = down;
      down = null;
      if (press.moved || !this.pickHandler) return;
      // Resolve where the press started — where the player aimed — not where
      // it was released a pixel or two later.
      this.pickHandler(this._pickNear(press.x, press.y, ASSIST_RADIUS[press.type] ?? 10));
    };
    this._onCancel = (e) => {
      active.delete(e.pointerId);
      down = null;
    };
    this._onLeave = () => {
      this._pendingHover = null;
      this._setHover(null);
    };
    el.addEventListener("pointerdown", this._onDown);
    el.addEventListener("pointermove", this._onMove);
    el.addEventListener("pointerup", this._onUp);
    el.addEventListener("pointercancel", this._onCancel);
    el.addEventListener("pointerleave", this._onLeave);
  }

  _unbindPointer() {
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this._onDown);
    el.removeEventListener("pointermove", this._onMove);
    el.removeEventListener("pointerup", this._onUp);
    el.removeEventListener("pointercancel", this._onCancel);
    el.removeEventListener("pointerleave", this._onLeave);
  }

  _setHover(id) {
    const ids = id ? (this.hoverGroup?.(id) ?? [id]) : [];
    if (ids.join() === this.hoverIds.join()) return;
    const old = this.hoverIds;
    this.hoverIds = ids;
    for (const x of old) this._apply(x);
    for (const x of ids) this._apply(x);
    this.renderer.domElement.style.cursor = id ? "pointer" : "";
    this.hoverHandler?.(id);
  }

  _cancelAnimation() {
    this.anim = null;
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  _loop(now) {
    this.frameId = requestAnimationFrame(this._loop);
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (now - a.t0) / a.ms);
      const k = 1 - Math.pow(1 - t, 3);
      this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
      if (t >= 1) this.anim = null;
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    // Hover is raycast at most once per frame, and only when idle — the
    // pointermove handler just records the position.
    if (this._pendingHover) {
      const { x, y } = this._pendingHover;
      this._pendingHover = null;
      if (this.root && this._hoverEnabled()) this._setHover(this._pickAt(x, y));
    }
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
  }
}
