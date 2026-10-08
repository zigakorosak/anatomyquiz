# Anatomy Quiz — Design Document

## Goal

A browser game for learning human anatomy, in the same style as GeoQuiz:
given some fact about a structure (its name, where it is, what it belongs
to), guess another fact about it. The question mode and answer mode are
picked independently and can be mixed and matched.

Like GeoQuiz, the system should be data-driven: adding attributes, answer
widgets, or datasets (body systems/regions) should not require changes to
the wizard, engine, or game screen.

## Tech stack

- Vanilla JavaScript (ES modules), no UI framework.
- [Vite](https://vite.dev/) for the dev server and build.
- [three.js](https://threejs.org/) for the 3D skeleton: `GLTFLoader` +
  `DRACOLoader` (Draco-compressed GLB), `OrbitControls`, raycast picking.
- No backend. Fully static; data is fetched from `public/data/` at runtime,
  using an `import.meta.env.BASE_URL` prefix so it resolves under
  `/anatomyquiz/`.
- Build-time only: Blender 5.2 (headless) to export the model, Node to
  build the item data. Playwright + Firefox (devDependency) for
  browser-driven checks.

## Architecture

Mirrors GeoQuiz: **attributes** describe quizzable facts, the **dataset**
describes the items, and a generic **engine** + **game screen** drive
rounds by looking up prompt/answer widgets by kind. No module outside
`attributes.js` special-cases an attribute by id.

```
src/
  core/
    dataset.js      — loads skeleton.json; buildQuizItems() (left/right merging); display names
    attributes.js   — attribute registry: name, latin, location
    regions.js      — region filter registry, two-level tree of predicates
    answers.js      — typed-answer normalization and matching
    engine.js       — QuizSession (round/scoring), pickChoices() (multiple-choice distractors)
    settings.js     — persistent preferences (localStorage), GeoQuiz's settings.js
    pool.js         — gamePool(): the items a game asks about (wizard counts + game share it)
  viewer/
    SkeletonViewer.js — three.js view: load, orbit, pick, visual states, muting, framing
    shared.js         — one viewer instance for the whole app, moved between screens
  ui/
    dom.js          — h() element helper
    screenKit.js    — shared full-screen "pick one of these" component
    hamburgerMenu.js — ☰ header menu (Restart / Back / Home), shared by game and explore
    settingsScreen.js — Settings: one section per preference (camera between rounds, zoom to answer)
    helpScreen.js   — How to play: short sections on how the game works (keep in step with features)
    home.js         — Games / Explore / How to play / Settings, credits
    gameWizard.js   — the Play flow's sequence of choice screens
    game.js         — round loop, feedback, summary
    prompts.js      — prompt widget registry, keyed by attribute.promptKind
    inputs.js       — answer widget registry, keyed by answer kind
    explore.js      — free-explore screen
    credits.js      — CC BY-SA attribution line (required, see below)
  main.js           — top-level screen router; screens may return a cleanup function
scripts/
  export-models.py   — Blender: atlas → skeleton.glb + insertions.glb, and their *-objects.json
  generate-data.mjs  — Node: objects + translations → skeleton.json, insertions.json
data/
  skeleton-objects.json, insertions-objects.json — intermediate exports, committed so
                        generate-data runs without Blender
public/data/
  skeleton.glb      — generated, 0.89 MB
  skeleton.json     — generated, 269 bones
  insertions.glb    — generated, 0.91 MB, 728 muscle-attachment patches (705 + 23 mirrored)
  insertions.json   — generated, 728 patches = 235 attachments (muscle × origin/insertion)
```

### Data pipeline

```
reference/…/Startup.blend ──(npm run export-models)──▶ public/data/skeleton.glb, insertions.glb
                                                     └─▶ data/skeleton-objects.json
data/skeleton-objects.json + Translations0.txt ──(npm run generate-data)──▶ public/data/skeleton.json
```

Both outputs are committed. The deploy workflow only runs `vite build`;
it can't run Blender, and doesn't have `reference/`.

**Source file.** The full atlas, `Z-Anatomy_Template/Z-Anatomy.zip` →
`Z-Anatomy/Startup.blend` (unzipped into `reference/`). Not
`Z-Biomechanics/Z-Anatomy.blend`: that one is rigged to an armature and
its names are messy (`Trapezoid bone.001`, unsided phalanges). The atlas
names are consistent (`Femur.l`/`Femur.r`) and objects hang under a tree
of `.g` group empties (`Bones of cranium.g`, `True ribs.g`, …) that
`generate-data` turns into each item's `groups` chain.

**`export-models.py`** exports both models in one Blender run (loading
the atlas takes ~1.5 min; the whole run ~6.5 min, mostly decimating the
705 patches). For the skeleton it takes every mesh in the "1: Skeletal system"
collection, except:

- the `.g` group placeholders,
- `Sinus of frontal bone` / `Sinus of sphenoid bone` (interior air
  spaces, can't be seen or clicked),
- the six ethmoid air-cell meshes, which are merged into `Ethmoid bone`.

That leaves 269 objects. For each one it applies all modifiers (32 use a
level-1 Subdivision Surface, `Xiphoid process` a Mirror, `Ethmoid bone`
six Booleans), bakes world transforms, maps the atlas's many materials
(`Bone-1`…`Bone-8`, `Cartilage`, `Teeth`, `Teeth-roots`) to three named
materials (`bone`, `cartilage`, `tooth`), and decimates to 25% of its
triangles (floor of 400 so phalanges and ossicles keep their shape):
700k → 205k triangles. Glb export uses Draco (level 7): **0.89 MB**.
Tunable with `DECIMATE_RATIO` / `MIN_TRIS` env vars.

Two traps:

- Blender's Draco library (`lib/libdraco.so.9`) isn't on the loader path
  when Blender runs headless, so the npm script sets `LD_LIBRARY_PATH` to
  Blender's `lib/`.
- The export copies must take over their source objects' names. The script
  renames each source object (`… [source]`) before creating the copy,
  and fails if a copy still ends up suffixed. Otherwise Blender calls the
  copy `Femur.l.001` and no click matches an item (this happened). The
  three materials get the same check (`bone`, not `bone.001`).
- The export is deterministic: re-running it reproduces all three outputs
  byte for byte.

**`generate-data.mjs`** joins each object's base name (side suffix
stripped) to `Translations0.txt`: English, English synonyms, Latin,
Latin synonyms. Every one of the 269 items and 32 groups has a match;
the script fails if a future export adds one that doesn't. Item shape:

```json
{"id":"Femur.l","name":"Femur","side":"left","latin":"Os femoris",
 "synonyms":["Thigh bone","Femoral bone"],"latinSynonyms":[],
 "groups":["Bones of free part of lower limb","Bones of lower limb","Skeletal system"],
 "tissue":"bone"}
```

`id` is the Blender object name, which is also the glTF node name. That
is the only link between the data and the model.

**Muscle attachments** come from the "2: Muscular insertions" collection:
705 thin patches on the bones, 167 muscles. Each is named
`<muscle>.<o|e><part?><l|r>` (o = origin, e = insertion, "End" in the
atlas; a part number for muscles attached in several places), is parented
to the bone it sits on, and has a material naming the muscle's action
("End-Flexion fingers"). The exporter:

- skips their Subdivision Surface (with it they'd be ~931k triangles) and
  thickens the Solidify shell from 0.5 to 1 mm so the decimated bones
  don't bury them;
- decimates gently (50%, floor 40 triangles), 174k → 89k triangles;
- exports material "origin" or "insertion", and records the host bone
  (with the skeleton's " [source]" rename stripped) and the action;
- **corrects sides from the geometry**, because the atlas's labels aren't
  reliable:
  - **Labels**: a patch whose centre is at least 1 mm from the midline is
    labelled by the side it lies on (x > 0 = left). Closer than that, a
    patch on a sided bone takes the bone's side; on a midline bone it keeps
    its label. 55 patches were relabelled, many in swapped pairs (the
    scalenes, the rectus capitis origins and insertions, piriformis and
    procerus origins).
  - **Hosts**: a patch on the opposite side's bone gets the bone on its
    actual side. 2 cases: the popliteus origin and a rectus abdominis
    origin.
  - **Missing sides**: an attachment modelled on one side only gets the
    other side by mirroring the patch across x = 0 and snapping it onto
    the mirrored bone (Shrinkwrap, nearest surface point, above surface),
    then the same 1 mm shell. 23 patches, all from the 12 attachments
    that existed on the right only (labelled left): serratus posterior
    inferior and superior insertions, pectineus, piriformis, procerus,
    pronator quadratus, plantar interossei, short heads of biceps brachii
    and femoris, and two serratus anterior digitations.
  - Every correction is recorded in `data/insertions-objects.json`
    (`relabelledFrom`, `hostWas`, `mirroredFrom`). A collision (two
    patches corrected to one name) fails the export.
  - `generate-data.mjs` fails if any attachment has unequal left/right
    patch counts.
  - Checked in Firefox: 0 labels and 0 hosts disagree with the geometry;
    all 23 mirrored patches are clickable. They also sit on their bones as
    well as their originals do: 41–68% of probe points within 4 mm of the
    bone surface, vs 45–73% for the originals.

`generate-data.mjs` turns them into items:

```json
{"id":"Biceps brachii muscle.er","muscle":"Biceps brachii muscle",
 "latinMuscle":"Musculus biceps brachii","role":"insertion",
 "name":"Biceps brachii muscle — insertion","latin":"Musculus biceps brachii — insertio",
 "part":null,"side":"right","host":"Radius.r","action":"Biarticular"}
```

`name` and `latin` include the role, so the attributes and display code
work unchanged. The atlas brackets non-constant structures
("(Abdominal part of pectoralis major muscle)"); they're shown without
brackets. 166 of 167 muscles have a translation; the last ("Long head of
biceps femoris") has its Terminologia Anatomica Latin as an override. The
script fails if a patch's host isn't a known bone (none aren't).

### Subjects (`core/subjects.js`)

GeoQuiz's subject registry. Games start with "Choose a subject"; in
Explore, subjects are toggles (see Interface → Explore):

- **Bones**: as described throughout.
- **Muscle attachments**: one item per muscle and role ("Diaphragm —
  origin", all its parts). Question: its name or Latin name. Answer: click
  it (the only answer kind, so the wizard skips the answer step). A region
  holds an attachment when any of its patches sits on a bone in that
  region.

In attachments mode the viewer shows the patches (amber, drawn with a
polygon offset so they win against the bone surface), the region's bones
as a **backdrop** (solid, not clickable or hoverable), and other bones as
ghosts. Picks test backdrop bones too, only to block: a click that meets a
bone first selects nothing, so you can't pick an attachment on the far side
of a femur through it. The click assist (nearest pick on a miss) still
applies. Results frame the attachment **face-on**, from its host bone out
to the patch (`viewer.faceOn`).

Measured in Firefox, every patch framed and tried from 6 directions:
699/705 are clickable with nothing peeled; the other 6 (lateral pterygoid
origins behind the jaw, rectus capitis anterior origins under the skull)
after peeling 2 layers. In attachments mode the layers button peels
**bones only**; patches stay solid and clickable. Peeling patches with
their bone (tried first) left the rectus capitis anterior unreachable,
because the bone covering it (the atlas) is a deeper layer than its own
host (the occipital).

### Left and right (`core/dataset.js`)

`buildQuizItems(raw, { sides })` produces the quiz items for a game:

- `"ignore"` ("Doesn't matter" in the wizard): pairs
  merge into one item keyed by name, owning both meshes. Clicking either
  femur answers "Femur". 154 items.
- `"match"`: one item per mesh, displayed "Femur (left)". 269 items.

Typed answers with sides that matter must include the side, accepted in
English or Latin, before or after ("left femur", "femur (left)",
"os femoris sinister").

### Attributes (`core/attributes.js`)

| id | promptKind | answerKinds |
|---|---|---|
| `name` | `text` | `type`, `choice` |
| `latin` | `text` | `type`, `choice` |
| `location` | `highlight` | `click` |

Any question/answer pair of different attributes is offered, so six
modes: name→location, latin→location, location→name, location→latin,
name→latin, latin→name.

**Give-away filter** (`core/pool.js`). An item is left out when its prompt
would itself be an accepted answer. 15 bones have identical English and
Latin names (Humerus, Radius, Ulna, Tibia, Fibula, Patella, Scapula,
Calcaneus, Maxilla, Vomer, Atlas, Axis, and the three ossicles), and the
vertebrae and Coccyx/Talus list the English name as a Latin synonym. For
multiple choice only the primary name is compared (that's all the options
show). For typed answers synonyms count too, so name→latin typed drops the
vertebrae as well. The wizard's item counts come from the same `gamePool()`,
and a region that ends up empty (Ear ossicles in English↔Latin) is shown
disabled with "Nothing to ask in this mode".

### Regions (`core/regions.js`)

A region never crops the model. The whole skeleton is always loaded;
items outside the region are **muted** and **not raycast**, so they
neither take clicks nor block clicks on what's behind them.

Muted bones are a very pale, nearly flat ghost: near-white (`#f4f1ea`),
7% opacity, emissive to wash out the shading, and exactly **one layer per
pixel** everywhere, so the head fades exactly like the pelvis. They're
drawn in two passes, both after the opaque pass:

1. A depth-only copy of every muted mesh (shared `colorWrite: false`
   material, `renderOrder` 1) writes the nearest muted surface's depth.
2. The ghost colour (`depthWrite: false`, `renderOrder` 2) passes the
   default LessEqual depth test only where its surface is that nearest one.

Two earlier versions stacked layers. The first used plain transparency.
The second sorted ghosts front-to-back by object, but sorting is per
object (by centre), not per pixel, so it still stacked wherever bones
interleave in depth. The head was the worst: skull plates, jaw, teeth.
Measured on a side view, the 95th-percentile ghost brightness dropped from
31.8 to 16.9 (= the median, so one layer) and the max from 73 to 20.
Playable bones are opaque and drawn before both passes, so they always
show through ghosts, including the ossicles inside the muted temporal bone
and the vertebrae behind a muted ribcage.

What's drawn solid is the **whole region**, even items the pool leaves out
as give-aways (Humerus, Radius, Ulna in Upper limb, English↔Latin). Muting
those made the chosen region look partly missing. The camera frames the region. This is GeoQuiz's "one map,
regions are framing + muting".

Tree: Whole skeleton · Head & neck (Skull, Teeth, Nasal & laryngeal
cartilages, Ear ossicles) · Trunk (Vertebral column, Thorax) · Upper limb
(Shoulder & arm, Hand) · Lower limb (Pelvis & leg, Foot). Mostly group
membership. Two exceptions:

- **Hand**: the atlas has no hand group. All 60 free-upper-limb meshes sit
  in one group, so Hand = that group minus Humerus/Radius/Ulna.
- **Ossicles** are excluded from Whole skeleton and Skull. They sit inside
  the temporal bone, which is playable (so opaque and pickable) in those
  regions. They have their own region, where the temporal bone is muted
  and click-through. That region is marked `standalone`, so it's also left
  out of Head & neck's "All of it", whose test is "any non-standalone
  child".

### Bottom toolbar (`ui/viewTools.js`)

The layers button and the plane cut, bottom centre of the 3D view (game
and Explore; above the credits line in Explore). Clicks on it never count
as "click anywhere to advance" (`e.menuClick`). Its state carries between
rounds and resets per game.

**Plane cut.** "Cut" turns it on (highlighted) and reveals three plane
buttons, Sagittal / Coronal / Transverse, and a slider. Sagittal starts
selected. The active plane button names the hidden side ("right hidden");
pressing it again flips the side. The slider moves the plane across the
bounds of what's in play (the region's bones, plus attachments in that
mode), captured when Cut is pressed. Pressing "Cut" again turns it off.
In the viewer (`setCut`):

- One `THREE.Plane` in an array that every material shares as
  `clippingPlanes`: bones, patches, ghosts and their depth pass, the x-ray
  copies, the caps. Empty when the cut is off. three recompiles on the
  plane-count change by itself.
- **Caps**, two kinds:
  - **Plane caps** (`_updatePlaneCaps`, stencil capping) make cut faces
    solid. For every solid mesh the plane crosses (typically a few dozen),
    in render order after the bones: its back faces +1 and front faces −1
    on the stencil (clipped, no colour, no depth test). That leaves the
    stencil non-zero exactly where the plane passes through the mesh's
    inside. Then a quad on the plane, in a darker shade (0.72) of the
    mesh's current colour, draws there, depth-tested, and resets the
    stencil for the next mesh. The cap sits *on* the plane, so it covers
    anything inside the bone. Back-face caps alone (the bone's far inner
    wall, the first version) let the costal cartilages' tips, which overlap
    into the sternum, show through its cut face, and get clicked through it
    (user report). A per-pixel depth push (gl_FragDepth to the plane) was
    tried next and dropped: a fragment can't tell whether its ray crossed
    the plane inside the mesh, so every bone beyond the plane flattened
    into a silhouette.
  - **Back-face caps**: every solid mesh also always draws its inside (back
    faces) in that shade, so a bone never looks hollow with the camera
    inside or right against it (user report: the left clavicle). Render
    time unchanged.

  Picking matches: where the ray is inside a mesh at the plane (its first
  hit on that mesh past the plane is a back face, from the hidden side),
  that mesh is picked. Verified:
  - Over the sternum body's cut face, all 295 sampled points pick the
    sternum (before: 78 picked a costal cartilage, 9 the manubrium).
  - Every one of the 997 meshes, in play, cut through its centre on all 3
    planes: see-through only at real openings (vertebral canal, sacral
    and sphenoid foramina, maxillary sinus, gaps between parts of one
    mesh) and 3 ring-shaped patch sections, which read 0 px with their
    bone shown.
  - A sagittal cut caps 45 meshes; render time 3.7 → 5.8 ms per frame
    (software WebGL).

  The exporter's `seal()` (holes filled, normals outward) keeps both kinds
  of cap valid.
- `boxOf()` measures the meshes' own geometry, not their children:
  `Box3.expandByObject` includes children, and the oversized cap quads
  then inflated a cut bone's box (framing zoomed far out).
- **Plane marker**: a faint quad in the accent blue (8% opacity, both
  sides) on the cut plane, spanning the region's extent in the other two
  axes (+10%). It's not clipped, not clickable, doesn't write depth, and
  shows only while cutting, so you can see where the plane passes, even
  through empty space.
- **Picking**: hits on the hidden side are ignored. Back faces are tested
  too while cutting (materials set to double-sided just for the raycast),
  so a click on a cut face picks that bone rather than whatever lies
  behind it.

Axes (glTF space): sagittal = x (+ = the body's left), coronal = z
(+ = front), transverse = y (+ = up). Unflipped keeps the +side.

### Layers button (`ui/layerButton.js`, `SkeletonViewer.computeLayers`)

A pill button at the bottom centre of the 3D view (game and Explore;
above the credits line in Explore). Each press hides the outermost layer
still showing ("Remove a layer 4/5"): those bones become the pale ghost and
can't be clicked or hovered, so the bones inside can. On the last layer it
reads "Show all layers 1/5", and the next press brings everything back. A
peeled bone with a state (the target, the answer, a pick) still draws in
colour. Its state carries between rounds and resets per game. It's hidden
when the bones in play form a single layer (Hand, Teeth, Ear ossicles), and
pressing it during a result doesn't advance the round. (It was a slider at
first; replaced at the user's request.)

Layers are **measured, not listed**, for whatever is in play, so they fit
every region and Explore:

- `peelExposure(ids)`: renders the set from 14 directions (6 axes, 8
  corners), orthographic, 256² px, as flat id colours, depth-peeled up to
  8 surfaces deep (a shader drops fragments at or in front of the previous
  pass's depth). Only front faces are drawn, so each bone counts once per
  surface it shows to a ray. A bone's **exposure** is the share of its
  pixels that are the first surface: visible from outside.
- `computeLayers(ids)`: peels in rounds. Each round splits the remaining
  bones at the natural break in their exposures (Otsu), and takes off the
  outer group only if the inner group is genuinely hidden (mean exposure
  < 0.45) and clearly apart (means ≥ 0.15 apart). Otherwise the rest is
  one layer. Then **every layer must hold at least 4 different
  structures** (left and right count once): a smaller layer merges into
  the next layer inward, or outward if it's the innermost
  (`mergeSmallLayers`). Cached per id set.

Calibration (from printed per-round exposures):
- No fixed threshold works: the skull's break is near 0.25, the trunk's
  (ribs 0.53–0.68 vs vertebrae 0.28–0.49) near 0.5.
- A median-layer measure (tried first) put the skull vault a layer too
  deep, because the inside of the far wall is seen across the cavity.
- Without the inner-group condition, the vertebral column peeled two
  vertebrae at a time from its ends: inner groups at 0.50–0.52, already
  easy to click.

- Tiny layers: the user found the skull's last layer (the ethmoid alone)
  pointless, because it's easy to click a step earlier. A check of every
  region found the same pattern elsewhere: two cuneiforms at the end of the
  foot, cuneiforms + navicular at the end of the lower limb, and incus /
  malleus / one incisor as a layer of their own in Explore. A
  "hidden from most directions" measure was tried and couldn't separate
  them from layers that matter (vertebrae behind ribs: hidden from 32% of
  directions; the lone ethmoid: 29%). Size did: every pointless layer had
  1–3 structures, every useful one 4+ (hence the merge rule).

Results (each layer's count of distinct structures):

| Region | Layers |
|---|---|
| Skull | 2: vault, face, jaw, hyoid (9) → lacrimal, palatine, sphenoid, inferior concha, vomer, ethmoid (6) |
| Head & neck (all) | 4: 16 → 10 → 6 → 4 |
| Trunk (all) | 2: ribs, sternum, costal cartilages (+ sacrum, coccyx, atlas, axis, L5) (29) → vertebrae (22) |
| Upper limb (all) | 2: 24 → carpals (8) |
| Lower limb (all) | 2: 21 → 11 |
| Foot | 2: 18 → 9 |
| Whole skeleton | 6; Explore 5 |
| Every other region | 1 (no button) |

Computing takes about 0.1–0.4 s per region (0.9 s for the whole skeleton)
in headless Firefox's software WebGL, less on a GPU. It runs 250 ms after
the screen draws, so it never delays the first frame.

### Viewer (`viewer/SkeletonViewer.js`)

- **Ids.** `GLTFLoader` sanitizes node names (`Femur.l` → `Femurl`), so
  the viewer recovers the original names through
  `parser.associations` → `parser.json.nodes[i].name`. A node with
  several materials loads as a group of meshes, all registered under the
  node's id.
- **States** per mesh id: `hover`, `selected`, `target`, `correct`,
  `wrong`, set by colour and emissive. Each mesh gets its own material
  clone. **X-ray**: `setXray(ids)` adds a translucent `depthTest: false`
  copy of the target, so a highlighted bone stays visible behind others.
- **Click vs drag.** A press is a click if it moves ≤ 6 px; otherwise
  it's an orbit/pan. Only the primary button picks (a right-click without
  dragging used to select). Once a second pointer goes down, the press is a
  pinch and never a click. The set of active pointers is cleared on every
  primary press, so a lost pointerup can't block clicks. The pick resolves at the **press** position, not the
  release, so a 1–2 px drift doesn't miss a 3 mm stapes. If the ray hits
  nothing, an **assist** searches rings 3 px apart (12 angles each) out to
  10 px for a mouse or 20 px for touch, and takes the first hit. It only
  applies on a miss, so a direct hit on a big neighbour always wins.
- **Hover** (mouse only) raycasts at most once per animation frame, and
  only while a screen wants it: a hover group (click-answer rounds) or a
  hover handler (Explore). In typed or multiple-choice rounds nothing
  lights up and the cursor stays normal, since clicking a bone does
  nothing there.
- **Framing.** `frame(ids, { direction })` fits the box's projected
  extent from the view direction rather than a bounding sphere, so a tall
  skeleton fills the height. `direction: "outward"` looks from the body's
  vertical axis toward the target, so a vertebra is seen from behind, the
  sternum from the front, a femur from the side. `minRadius` keeps
  context around tiny targets.
- **Render on demand**: the loop renders only when controls, an
  animation or a state change mark it dirty.
- **One instance** (`shared.js`): created on first use; `attach()` moves
  the canvas between screens, and `reset()` clears handlers, states and
  muting but keeps the camera. This avoids re-decoding and leaking WebGL
  contexts.
- `findClickPoint(id)` returns a screen point where a click would hit
  the mesh. It exists for tests: `shared.js` exposes the viewer as
  `window.__anatomy` in dev builds only.

### Interface: GeoQuiz's, screen by screen

The UI deliberately copies GeoQuiz (its source is in `reference/geoquiz/`):
its dark palette and button styles (`style.css` keeps GeoQuiz's class
names where a rule exists in both), its screens and its wording.

- **Home**: Games / Explore / How to play / Settings. Unlike GeoQuiz's wrapping row,
  menu-screen options (home, wizard, Settings) are a single centred column
  of equal-width buttons, at the user's request.
- **Wizard**: "What should we show you?" → "How do you want to answer?" →
  "How do you want to answer with the name?" → "How many options?" →
  "Choose a region" (with counts; parents open "Choose an upper limb
  region") → "Either side, or left and right separately?", the counterpart
  of GeoQuiz's sovereignty step, showing both counts. Steps are named
  objects, not closures, so the game can hand the whole wizard position
  back: ☰ → Back lands on the last step with every choice and the Back
  chain intact.
- **Game header**: "Round 3 / 27", "Score: 2", a live tenths timer, the
  action button (Confirm → Next → See Results), and ☰ (Restart / Back /
  Home).
- **Click-the-bone rounds**: the 3D view fills the screen below the header,
  and the action button, the question pill and the feedback pill float over
  its top edge (GeoQuiz's map-answer overlay).
- **Typed / multiple-choice rounds**: the action button sits in the header,
  the 3D view fills the middle (a text question floats over it as a pill;
  a highlighted bone needs no text, as GeoQuiz's map-highlight shows none),
  and the answer widget and feedback line sit below.
- **Answers**: options are `menu-option` buttons that turn solid green/red
  and fade the rest. The typed box autocompletes from every answer in the
  mode (a `<datalist>`, as GeoQuiz does) and turns read-only, not
  disabled, after the result. Feedback uses GeoQuiz's wording ("Correct!",
  "Correct answer: X", "You picked X — correct answer: Y") plus the name
  in the other language.
- **Summary**: "Game Over", "You scored X / N", total and average time,
  and every round listed green or red ("Label: wrong (was X) (1.2s)"),
  then Play Again / Back / Home. The buttons ignore clicks for the first
  500 ms (`REPORT_GUARD_MS`). They sit where you just clicked to finish the
  last round, and a quick second click used to skip the report.
- **Explore**: opens straight into the 3D view with bones. Header: a label
  ("Tap a bone" / "Tap an attachment" / "Tap a bone or attachment"), a
  **Subjects** dropdown, Random, and ☰ (Reset view / Home). Subjects is a
  list of checkboxes, one per subject, any mix on; it stays open while
  toggling, and a click elsewhere closes it. A subject's data and model load
  the first time it's turned on (its checkbox is disabled meanwhile). The
  enabled subjects' meshes are clickable. With bones off but another
  subject on, the bones are a solid backdrop; with nothing on, everything
  ghosts and Random is disabled. Turning a subject off clears its
  selection. The info card fits what was clicked (bone: name, group,
  Latin, synonyms, side; attachment: name and role, Latin, bone, action,
  side). Random picks from the enabled subjects (skipping the ossicles,
  hidden inside the temporal bone). How a subject shows in Explore is a
  small table in `ui/explore.js` (`EXPLORE`), so muscles and later
  subjects add an entry there.
- **How to play**: six short sections: the idea, starting a game,
  answering, moving the skeleton (the actual OrbitControls gestures),
  the bottom tools, and ☰ / Explore / Settings. It describes behaviour,
  so update it when features change.
- **Settings**: two sections, saved in localStorage
  (`anatomy-quiz-settings`). **Camera**: "Keep view between rounds"
  (default) or "Reset view every round", GeoQuiz's zoom setting for a
  camera. **After answering**: "Zoom to the answer" (default) or "Don't
  zoom". With "Don't zoom" the camera stays where the player left it, and
  the answer is still coloured green (and a wrong pick red) with the
  x-ray copy. Highlight prompts still frame the target when the round
  starts, because that framing is the question, not the result.

### Round flow (`ui/game.js`)

As in GeoQuiz: **select → confirm → result → next**.

- **Select**: click a bone (it turns blue, and hovering lights up the
  whole pair), pick an option, or type.
- **Confirm**: the header button, Enter, or re-selecting the same thing.
- **Result**: the right answer is always **green** and a wrong pick
  **red**, including in text modes. A wrong multiple-choice option or
  click shows the bone you actually chose, in red. The feedback line
  always gives the English and Latin names.
- **Next**: the action button, Enter, or a click anywhere — GeoQuiz's
  screen-wide click listener. It ignores the action button (own handler),
  the ☰ menu (`e.menuClick`), the click that just confirmed
  (`e.confirmClick`, set on that one event rather than a flag that could
  outlive it), and the 3D canvas, whose pick handler advances on a click but
  not on a drag, so turning the model to look at the answer doesn't skip
  it. Locked options and the read-only input stay clickable for this.

**Camera.** A `highlight` prompt frames the target from outside, with
context. For other prompts the player controls the view. On result the
camera glides to the target (and wrong pick), and the next round glides
back to the player's own view.

**Context radius** is a quarter of the region's size, clamped to
1.5–12 cm. A fixed 12 cm zoomed the ossicles region out to a whole-head
view where a stapes is one pixel.

A game covers every item in the region, in random order. The header shows
progress, score and a per-round timer. The summary shows score, %, total
and average time, and the missed items with Latin names.

**Multiple choice** (`pickChoices`): distractors come from the target's
own group first (other carpals for a carpal), then the rest of the pool.

**Typed answers** (`core/answers.js`) are matched exactly after
normalizing: case, accents, punctuation, a leading "the". There is no
typo tolerance, because one character is often the whole answer
("Vertebra T4"/"T5", "Fifth"/"Sixth rib"). Synonyms are accepted.

## Current scope (v1)

- Skeleton only: 269 meshes, or 154 items with sides merged.
- Home → Games (wizard), Explore (hover for names; click or Random for
  the info card), or Settings.
- Six question/answer modes. Typed or multiple choice (2–6) for names,
  click for location. Left/right "doesn't matter" or "must match".
  15 selectable regions in a two-level tree, with item counts.

## Possible next steps

- More systems from the same atlas (muscles are the obvious next one, but
  at 2M polygons they'll need harder decimation and layer controls, since
  muscles cover bones).
- A `group` attribute ("Which group is this bone in?") from `groups`.
- Descriptions from `Definitions/*.txt` in Explore.
- Other languages (French, Spanish and Portuguese are already in
  `Translations0.txt`).
- Code-split three.js out of the home screen bundle (the JS is about
  169 KB gzipped, almost all three).

## Data & license

Source material lives in `reference/` (local only, gitignored, ~2.3 GB):

- `Z-Anatomy-PC-Version/Z-Anatomy PC/Assets/Models/1.0 Models/*.fbx`: the
  3D models, one FBX per system: Skeletal, Muscular, Nervous,
  CardioVascular, Visceral, Joints, LymphoidOrgans, Regions of human body,
  Reference lines/planes. Sizes range from 0.4 to 65 MB, so they're too
  heavy to ship as-is.
- `.../Assets/Resources/Translations0.txt`: about 7,300 structure names, `;`-separated:
  English; synonyms; Latin; synonyms; French; synonyms; Spanish; synonyms;
  Portuguese; synonyms. Synonyms are `%`-prefixed.
- `.../Assets/Resources/Hierarchy order.txt`: about 6,000 lines of `Name;index`
  giving the tree order. Name suffixes: `.g` = group, `.l`/`.r` = left/right,
  `.t` = text label/landmark, `.j`/`.s` seen in groupings.
- `.../Assets/Definitions/*.txt`: about 3,700 descriptions (mostly Wikipedia
  text), with `;;;ES;;;`, `;;;PT;;;`, `;;;FR;;;` separating languages.
- `Z-Anatomy-PC-Version/Resources/Layers/*.csv`: curated collections per
  system (Bones, Muscles, Arteries, Veins, Nerves, …, plus BONUS groupings
  like "Bones of left hand"). These are good candidates for quiz
  "regions"/filters. Contain placeholder junk (`????????`, `?x.r`).
- `Z-Anatomy_Template/Z-Anatomy/Startup.blend` (unzipped from
  `Z-Anatomy.zip`, 305 MB): **the full atlas, the export source**. It has
  7,184 objects (4,569 meshes), about 3.7M polygons across all systems,
  and the skeleton in "1: Skeletal system" (278 meshes).
- `Z-Biomechanics/Z-Anatomy.blend`: a rigged, posable skeleton plus
  muscle insertions. Not used (see "Data pipeline").
  Both are readable headless with Blender (see "Environment notes").

**License:** CC-BY-SA 4.0 (Z-Anatomy), derived from BodyParts3D
(CC-BY-SA 2.1 Japan). Anything shipped that is derived from this data
(names, geometry, renders) must carry attribution to both and be shared
under the same license. `ui/credits.js` puts the attribution line on the
home and Explore screens. `public/data/*` is CC BY-SA.
Attribution strings, as Z-Anatomy specifies:

- "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
- "Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0"

## Project conventions

- **Docs**: four markdown files, each with one job: this one
  (design/overview), `LOG.md` (chronological history), `MISTAKES.md`
  (process lessons, read before a debugging round), `README.md`
  (outward-facing intro). Don't add further `.md` files.
- **Archiving**: after a significant change, run `npm run archive --
  <short-label>`. It excludes `node_modules`, `dist`, `archive` and
  `reference`, and keeps the 10 most recent snapshots.
- **Release scripts**: `scripts/git-push.sh "msg"` stages everything,
  refuses credential-looking paths, commits and pushes. `scripts/deploy.sh`
  triggers the manual deploy workflow, waits for a run newer than the
  previous latest to appear (so it never watches an old one), and waits
  for pass/fail.
  `scripts/push-deploy.sh "msg"` runs both, and
  `scripts/archive-p-d.sh <label> "msg"` archives first.
- **Scratch scripts**: `scratch-*.mjs` in the project root (gitignored),
  deleted in the same turn they're finished with.
- **Generated data**: `public/data/*` and `data/*` are generated by
  `npm run export-models` / `npm run generate-data` from `reference/`.
  Never edit them by hand. Re-run both after changing either script.

## Deployment

Target: `zigakorosak.com/anatomyquiz/` on Namecheap shared hosting
(cPanel), the same host as GeoQuiz. `.github/workflows/deploy.yml` builds
on GitHub's runner and FTPS-uploads `dist/`. It is **manual only**
(`workflow_dispatch`): run it from the Actions tab or with
`gh workflow run "Deploy to Namecheap"`.

`vite.config.js` sets `base: "/anatomyquiz/"`. If the deploy path changes,
that line must change to match.

**One-time setup (done 2026-10-06):**

1. ~~Create the GitHub repo and push.~~ Done: `github.com/zigakorosak/anatomyquiz`.
2. cPanel FTP account `ftpaccanatomyquiz@zigakorosak.com`, scoped to
   `public_html/anatomyquiz`.
3. Repo secrets `FTP_SERVER` (`zigakorosak.com`), `FTP_USERNAME`,
   `FTP_PASSWORD`.

Gotchas from GeoQuiz's setup:

- Use the bare domain `zigakorosak.com` for `FTP_SERVER`. The
  `ftp.zigakorosak.com` that cPanel suggests doesn't resolve (NXDOMAIN).
- `server-dir` is relative to the FTP account's own login root. With an
  account scoped to `public_html/anatomyquiz`, it must be `./`, or the app
  ends up nested inside itself.
- Pin `SamKirkland/FTP-Deploy-Action@v4.4.0`. There is no `@v4` tag.
- Secrets are write-only. The only way to check them is a deploy run.

## Environment notes

- Node 26, npm 12, `gh` (authenticated as zigakorosak), `git`,
  `rsvg-convert`, `python3`, `7z` available. Firefox is the user's
  browser. Playwright is a devDependency with its Firefox build installed
  (`npx playwright install firefox`; it warns that Arch isn't officially
  supported, but the Ubuntu fallback build works). Headless Firefox runs
  WebGL, so the real app can be driven, screenshotted and click-tested
  here.
- Blender 5.2.0 LTS at `~/.local/bin/blender` (links to
  `~/Applications/blender-5.2.0-linux-x64`), installed 2026-10-06.
  Runs headless: `blender -b file.blend --python script.py`. Opening the
  Z-Anatomy files logs one `Error in PyDriver` because driver scripts
  don't auto-run in background mode. It doesn't affect the data.
  Loading `Startup.blend` takes about 1.5 minutes, as does a full export.
- Blender can also render a quick check image of an exported GLB
  headless (Workbench engine, orthographic camera).
