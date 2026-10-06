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
    pool.js         — gamePool(): the items a game asks about (wizard counts + game share it)
  viewer/
    SkeletonViewer.js — three.js view: load, orbit, pick, visual states, muting, framing
    shared.js         — one viewer instance for the whole app, moved between screens
  ui/
    dom.js          — h() element helper
    screenKit.js    — shared full-screen "pick one of these" component
    home.js         — Play / Explore, credits
    gameWizard.js   — the Play flow's sequence of choice screens
    game.js         — round loop, feedback, summary
    prompts.js      — prompt widget registry, keyed by attribute.promptKind
    inputs.js       — answer widget registry, keyed by answer kind
    explore.js      — free-explore screen
    credits.js      — CC BY-SA attribution line (required, see below)
  main.js           — top-level screen router; screens may return a cleanup function
scripts/
  export-skeleton.py — Blender: atlas → public/data/skeleton.glb + data/skeleton-objects.json
  generate-data.mjs  — Node: objects + translations → public/data/skeleton.json
data/
  skeleton-objects.json — intermediate export, committed so generate-data runs without Blender
public/data/
  skeleton.glb      — generated, 0.89 MB
  skeleton.json     — generated, 269 items
```

### Data pipeline

```
reference/…/Startup.blend ──(npm run export-skeleton)──▶ public/data/skeleton.glb
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

**`export-skeleton.py`** takes every mesh in the "1: Skeletal system"
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
7% opacity, emissive to wash out the shading. They keep `depthWrite` on,
and the renderer sorts transparent objects **front-to-back**
(`setTransparentSort`; three's default is back-to-front). So at any pixel
only the nearest muted surface is drawn. Without that, overlapping ghosts
(ribs over spine, both legs) stacked into muddy grey patches. Playable
bones are opaque and drawn first, so they always show through, including
the ossicles inside the muted temporal bone. The camera frames the region. This is GeoQuiz's "one map,
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

### Round flow (`ui/game.js`)

As in GeoQuiz: **select → confirm → result → next**.

- **Select**: click a bone (it turns blue, and hovering lights up the
  whole pair), pick an option, or type.
- **Confirm**: the header button, Enter, or re-selecting the same thing.
- **Result**: the right answer is always **green** and a wrong pick
  **red**, including in text modes. A wrong multiple-choice option or
  click shows the bone you actually chose, in red. The feedback line
  always gives the English and Latin names.
- **Next**: the header button, Enter, or a click (not a drag) on the
  skeleton.

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
- Home → Play (wizard) or Explore (hover for names; click for name,
  Latin, synonyms and group path).
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
- A settings screen (e.g. keep or reset the view between rounds).

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
  `npm run export-skeleton` / `npm run generate-data` from `reference/`.
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
