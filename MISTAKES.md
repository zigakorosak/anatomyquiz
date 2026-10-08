# Mistakes & Lessons

A working reference for the assistant. `DESIGN.md` says what the code is,
`LOG.md` says what changed and why, and this file says **what went wrong
while getting there**, so the same time and tokens aren't spent twice.

Read this before a debugging round, especially a visual or rendering one.
Add to it whenever something takes more than one attempt.

The lessons below are carried over from GeoQuiz (`reference/MISTAKES.md`,
which has the full stories). They are the ones that transfer to any
project; the map-specific ones were left out.

---

## The single biggest lesson

**A bug reported twice means the theory is wrong. Stop theorizing and go
measure.** In GeoQuiz, one rendering bug took five rounds of plausible,
confident, wrong fixes. Building a way to observe the real output found
the cause in a single pass. The second time a symptom is re-reported, the
next action is building observation tooling, not another fix.

## Verification playbook

- **Rasterize and look.** `rsvg-convert -w 800 -h 500 in.svg -o out.png`,
  then `Read` the PNG. Serialize the *real* output rather than a
  hand-built approximation. rsvg doesn't resolve CSS custom properties,
  so substitute `var(--x)` first.
- **Drive a real browser for anything about hit-testing or input.** jsdom
  has no geometric hit-testing (`dispatchEvent` on an element always
  "hits" it), so its click tests can't fail for the bugs that matter.
  Playwright works here.
- **Test in Firefox.** It's the user's only browser, and it has differed
  from Chromium on event targets. `npx playwright install firefox`.
- **Jitter synthetic clicks** (down, move 1–3px, up). Perfectly still
  clicks hid a real "click does nothing" bug.
- **Measure incrementally**: change one input at a time and print the
  metric.
- **Check a control**: when changing shared code, verify the unaffected
  path is unchanged.

## Recurring mistake patterns

1. **Asserting instead of computing.** If a fix depends on a CSS
   specificity, inheritance, or precedence claim, compute it. After
   wiring a listener, verify the element can actually receive the event.
2. **Explaining a symptom instead of fixing it.** Correctly naming what a
   thing *is* doesn't answer whether it *looks wrong*. Check your own
   recent diffs.
3. **"This can only help."** Before widening, padding, or thickening
   anything, state whether the defect is missing pixels or extra pixels.
   They need opposite fixes.
4. **`stopPropagation()` is a cross-module change.** Grep for root or
   delegated listeners that depend on the event first.
5. **Forgetting siblings in an element family.** When adding to a group
   with shared per-tick or per-copy handling, grep every place that
   enumerates the family.
6. **Zoom-dependent constants baked into geometry.** px values inside a
   zoomed/scaled group need explicit counter-scaling.
7. **Thresholds calibrated at one viewport size.** Prefer scale-invariant
   measures. Test at 3 or more sizes, including portrait.
8. **Filtering by the wrong property.** Print the sorted distribution of
   keep vs. drop before choosing a threshold, and confirm there's a gap.
9. **Overclaiming in docs.** Write what was verified, not how confident
   it felt.
10. **Prefer geometry over DOM hit-testing** when the handler already has
    the coordinates.

## Environment gotchas

- jsdom harness: stub `global.performance = { now: () => Date.now() }`
  (assigning `dom.window.performance` recurses infinitely), stub
  `ResizeObserver`, and end scripts with `process.exit(0)` if a timer is
  running.
- Scratch scripts go in the project root as `scratch-*.mjs` so imports
  resolve. Delete them when done.
- `npm install --no-save X` followed by `npm uninstall Y` prunes no-save
  packages. Reinstall when imports start failing.
- Chromium ignores `will-change` on inner SVG elements. For per-frame
  pan/zoom, transform the `<svg>` or an HTML wrapper, then bake the
  transform on settle.

---

## Project-specific traps

- **Sorting transparent objects is per object, not per pixel.** "Draw the
  nearest ghost first" by object centre looked right on a front view and
  failed wherever meshes interleave in depth (the whole skull). For
  "exactly one translucent layer", use a depth pre-pass, then colour at
  equal depth. Measure ghost brightness percentiles across the image
  instead of eyeballing one view: stacking shows as a 95th percentile near
  twice the median.
- **Don't trust source-data labels that geometry can check.** The atlas's
  left/right labels were wrong on 55 of 705 attachment patches. Measure
  (which side of x = 0) instead of believing the name. And when choosing
  a "close enough to the midline" zone, list what falls inside it first:
  5 mm hid real paired patches at ±1.4 mm.
- **Flipping `material.transparent` needs `material.needsUpdate = true`.**
  three compiles an opaque material with alpha forced to 1 and keeps that
  shader. Toggling `transparent` alone leaves a bone that was first drawn
  solid stuck solid (here: bright white ghosts after visiting Explore).
  Test state changes after the *other* state has been rendered first, not
  only from a fresh load.
- **Don't add children inside `traverse()`.** three's traverse walks into
  children added during the walk. Adding a mesh to each mesh recursed
  forever. Collect first, then modify.

- **Never `pkill -f` / `pgrep -f … | xargs kill` with a pattern from your
  own command line.** The shell running the command matches too and gets
  killed (exit 144), skipping everything after it, including cleanup.
  The `grep "[v]ite"` trick is NOT enough: it only stops grep matching
  itself. The parent `bash -c` still contains the full text whenever the
  same command mentions it elsewhere (a third time this happened). Match
  on the argv fields instead, e.g.
  `ps -eo pid,args | awk '$2=="node" && $3=="scratch-x.mjs" {print $1}'`
  (the shell's own `$2` is never `node`), and do the kill in its own
  command.
- **"Off" switches in a DOM helper.** A helper that skips `false` props
  silently drops `spellcheck: false`, `disabled: false` and similar.
- **A quiz prompt can give itself away.** Check whether the shown value is
  among the accepted answers (identical English/Latin names, synonyms).
  Filter in one shared place, so counts and games agree.

- **Check the PATH yourself before declaring a tool missing, and recheck
  when told.** Blender was reported as not installed, based on one
  `which` at the start. The user had installed it minutes later
  (`~/.local/bin/blender`), and had to point it out. On "I think I have X",
  search properly (`which`, `~/.local/bin`, `~/Applications`, flatpak).
- **Blender `objects.new(name)` silently renames on collision** (adds
  `.001`). Any export that recreates objects must free the name first,
  and should assert the result. The `.001` suffix broke every click and
  only showed up in the browser.
- **The `hidden` attribute loses to any class that sets `display`.** Keep
  the global `[hidden] { display: none !important }` in style.css.
- **`el.replaceChildren(a, null, b)` renders the text "null".** Use `h()`
  or filter the arguments first. This happened three times (Explore panel,
  feedback line, plane buttons). Grep for `replaceChildren(` with a
  conditional argument before calling a UI change done.
- **`Box3.expandByObject` includes children.** Helper meshes added as
  children (cap quads, x-ray copies) silently change a mesh's "size".
  Measure the geometry itself.
- **Test in the state the user is in.** A patch-cap sweep ran with the
  attachments subject off, so the patches were ghosts and got no caps by
  design: 21 false "holes".
- **Placing a test camera "inside" a mesh:** a bounding-box centre can lie
  outside a curved bone (the S-shaped clavicle), and three's Raycaster
  only reports front faces, so "the second hit is the exit" never fires.
  Take a surface vertex and step inward along its normal. Check the test
  shows the old behaviour before trusting the "fixed" picture.
- **Heredoc delimiters must match.** `<<'EOF'` closed by `PYEOF` feeds
  the rest of the command into the program (twice: nothing ran, but a
  stray re-run of an edit script almost went with it). Put multi-line
  edits in a file, then run the file.
- **Screenshots and computed styles right after a click can catch a CSS
  transition mid-way** (buttons fade over 0.15 s). Wait it out before
  judging colours.
- **Size-dependent constants must scale with the region.** A 12 cm camera
  margin suits a femur and is 40× too big for a stapes. Same lesson as
  GeoQuiz #6/#7, in 3D.
- **Test the camera's resting state, not mid-animation.** A Playwright
  click computed while the camera was still gliding missed. Wait out the
  450 ms `frame()`/`setView()` animation before measuring screen points.
- **Resolve clicks at the press point.** At 3 mm targets, the 1–2 px
  between press and release decides whether you hit the bone.
- **Testing picks:** `viewer.findClickPoint(id)` (via `window.__anatomy`
  in dev) returns a point that the real raycast confirms. Drive real
  jittered mouse clicks there; never call the pick handler directly
  (GeoQuiz #10).
