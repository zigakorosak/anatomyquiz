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

- **Never `pkill -f` / `pgrep -f … | xargs kill` with a pattern from your
  own command line.** The shell running the command matches too and gets
  killed (exit 144), skipping everything after it, including cleanup.
  This happened twice in one session. Kill by exact PID from
  `ps -eo pid,args | grep "[v]ite preview"` instead (the `[v]` keeps
  grep from matching itself).
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
  or filter the arguments first.
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
