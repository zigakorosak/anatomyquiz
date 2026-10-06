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

// Visual states. `null` is the plain look.
const STATE_COLORS = {
  hover: 0xf2c46b,
  selected: 0x4f8fe0,
  target: 0xd9603b,
  correct: 0x3fa45b,
  wrong: 0xd2404a,
};

// Bones outside the played region: very pale and see-through.
const MUTED_COLOR = 0xf4f1ea;
const MUTED_OPACITY = 0.07;

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

export class SkeletonViewer {
  constructor(container, { modelUrl }) {
    this.container = container;
    this.modelUrl = modelUrl;

    this.meshes = new Map(); // mesh id -> [THREE.Mesh] (one per material primitive)
    this.playable = null; // Set of mesh ids, or null = everything
    this.states = new Map(); // mesh id -> state name
    this.hoverIds = [];
    this.hoverGroup = null; // (meshId) => mesh ids to hover together
    this.pickHandler = null;
    this.hoverHandler = null;
    this.xrays = [];
    this.anim = null;
    this.dirty = true;

    // Transparent, so the stage's CSS background shows through.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "viewer-canvas";
    container.append(this.renderer.domElement);

    // Transparent objects front-to-back (three's default is back-to-front),
    // so muted ghosts, which keep depthWrite, draw only their nearest
    // surface instead of piling up. The x-ray copies ignore depth, so the
    // order doesn't affect them.
    this.renderer.setTransparentSort(
      (a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || a.z - b.z,
    );

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
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
    const draco = new DRACOLoader();
    // three's own glTF decoder build, bundled by Vite (hashed URLs, no copy step).
    draco.setDecoderPath(DRACO_GLTF_CONFIG);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(this.modelUrl);
    draco.dispose();

    // GLTFLoader sanitizes node names ("Femur.l" -> "Femurl"), so recover the
    // original names from the glTF JSON via the parser's associations.
    const { parser } = gltf;
    gltf.scene.traverse((obj) => {
      const assoc = parser.associations.get(obj);
      if (assoc?.nodes === undefined) return;
      const id = parser.json.nodes[assoc.nodes].name;
      const list = [];
      obj.traverse((m) => {
        if (!m.isMesh) return;
        const tissue = m.material?.name in TISSUE_COLORS ? m.material.name : "bone";
        m.material = new THREE.MeshStandardMaterial({
          color: TISSUE_COLORS[tissue],
          roughness: 0.75,
          metalness: 0,
        });
        m.userData.meshId = id;
        m.userData.baseColor = TISSUE_COLORS[tissue];
        list.push(m);
      });
      if (list.length) this.meshes.set(id, list);
    });
    this.root = gltf.scene;
    this.scene.add(this.root);

    this.bounds = new THREE.Box3().setFromObject(this.root);
    this.frame(null, { animate: false });
    this._applyAll();
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
  reset() {
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

  get meshIds() {
    return [...this.meshes.keys()];
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
  }

  clearStates() {
    const ids = [...this.states.keys()];
    this.states.clear();
    for (const id of ids) this._apply(id);
    this.setXray([]);
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

  /** World-space bounding box of these meshes. */
  boxOf(ids) {
    const box = new THREE.Box3();
    for (const id of ids) for (const m of this.meshes.get(id) ?? []) box.expandByObject(m);
    return box;
  }

  _hoverEnabled() {
    return Boolean(this.hoverGroup || this.hoverHandler);
  }

  _isPlayable(id) {
    return !this.playable || this.playable.has(id);
  }

  _applyAll() {
    for (const id of this.meshes.keys()) this._apply(id);
  }

  _apply(id) {
    const state = this.states.get(id) ?? (this.hoverIds.includes(id) ? "hover" : null);
    const muted = !this._isPlayable(id) && !this.states.has(id);
    for (const m of this.meshes.get(id) ?? []) {
      const mat = m.material;
      if (muted) {
        // A pale, nearly flat ghost. depthWrite stays on: with the
        // front-to-back transparent sort (constructor), only the nearest
        // muted surface is drawn at any pixel, so overlapping bones don't
        // stack into grey.
        mat.color.setHex(MUTED_COLOR);
        mat.emissive.setHex(MUTED_COLOR);
        mat.emissiveIntensity = 0.6;
      } else {
        mat.color.setHex(state ? STATE_COLORS[state] : m.userData.baseColor);
        mat.emissive.setHex(state ? STATE_COLORS[state] : 0x000000);
        mat.emissiveIntensity = state ? 0.25 : 0;
      }
      mat.transparent = muted;
      mat.opacity = muted ? MUTED_OPACITY : 1;
      mat.depthWrite = true;
      m.renderOrder = muted ? 1 : 0;
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
    const targets = [];
    for (const [id, list] of this.meshes) if (this._isPlayable(id)) targets.push(...list);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.meshId : null;
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
