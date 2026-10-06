# Project Log

Newest first. What changed and why.

## 2026-10-06: Back button on the report screen

User request. The report now has Play Again / Back / Home. Back returns to
the wizard's last step with every choice kept, the same as ☰ → Back.

The user also reported that the ear-ossicles game had no report screen.
It didn't reproduce: the report appeared in every ossicles game tried
(click with either side and with sides separate, typed on a highlighted
bone; advancing via Next, Enter, a click on the 3D view, a click on the
header, and touch taps). A full sweep of every mode × region × sides,
played to the report through the real UI, was started and then stopped
at the user's request. 16 complete games had passed, including Whole
skeleton typed (151 rounds). Not yet investigated: an early version of
the sweep, which only tried front and back views, found no clickable
point on the hyoid or the palatine bone in some click rounds.

## 2026-10-06: every faded body part fades the same; consistency fixes

User report: when the head isn't being played it should go see-through
like the other body parts. Measured first. A side view showed the head
ghost full of brighter patches (stacked layers); the pelvis had a few too,
where the hand overlaps the hip. The front-to-back sort from the earlier
ghost change works per object, not per pixel, so wherever bones interleave
in depth (skull plates, jaw, teeth) a farther surface still drew over a
nearer one. Replaced with a two-pass ghost (depth-only pre-pass, then
colour at equal depth): exactly one layer per pixel. Ghost brightness on
the head: 95th percentile 31.8 → 16.9 (the median), max 73 → 20; pelvis
31.7 → 16.9. Checked that playable bones still show through (T6 is
clickable from the front through the ghost ribcage) and that the ossicles
stay visible inside the ghost skull.

Introduced and fixed along the way: adding the depth copy as a child
inside `traverse()` made traverse walk into it and recurse forever (stack
overflow; the game showed "Couldn't load the skeleton"). Now meshes are
collected first, then set up.

Similar inconsistencies found and fixed:
- **Regions looked partly missing in English↔Latin modes**: give-away
  items (Humerus, Radius, Ulna in Upper limb) were muted like out-of-region
  bones. The whole region is drawn solid now; only the question pool skips
  them.
- **Typed answers with "left and right separately"** gave no hint that the
  side is required (multiple choice shows "(left)" on every option). The
  hint was lost in the GeoQuiz rebuild. The placeholder says "…, with left
  or right…" again.
- **Feedback brackets**: "Femur (left) (Os femoris (left))" →
  "Femur (left) · Os femoris (left)", and the second name is left out when
  it's identical ("Tibia (left) · Tibia (left)" → "Tibia (left)").

## 2026-10-06: setting to not zoom onto the correct answer

User request. Settings gets a second section, "After answering": "Zoom to
the answer" (default, the existing behaviour) or "Don't zoom" (new
`zoomToAnswer` preference). With it off, confirming leaves the camera
where it is; the answer is still coloured and x-rayed. The Settings screen
became a list of sections instead of one hardcoded block. Checked in
Firefox: both sections show; "Don't zoom" survives a reload alongside the
Camera choice; with it off the camera position and target are unchanged
after confirming (click and typed rounds) while the answer is still marked
correct; with it on, the camera moves.

## 2026-10-06: license line at the bottom of the main menu

User request. Menu screens are now full height (`height: 100%`, scrolling
internally when taller), so the credit line's existing `margin-top: auto`
puts it at the bottom; home's bottom padding is trimmed via
`.menu-screen:has(> .credits)`, and `text-wrap: balance` stops a lone
"JP)." wrapping onto its own line. Measured in Firefox: 12 px from the
bottom at 1280×800 and 390×844. A 260 px tall window scrolls inside the
menu (the page itself still doesn't), and the wizard screens are
unchanged.

## 2026-10-06: menu buttons stacked in a centred column

User request: menu buttons one under the other, in the middle of the
screen. On the home, wizard and Settings screens the options are now a
single column, all the same width (up to 22rem), centred; Settings'
section heading is centred over them. This departs from GeoQuiz's
wrapping row. In-game multiple-choice options keep the wrapping row.
Measured in Firefox: buttons centred at x = 640 of 1280, and centred on a
390 px phone.

## 2026-10-06: interface rebuilt to match GeoQuiz

User added GeoQuiz's source to `reference/geoquiz/` and asked for the
interface to be more like it. Read its UI code (style.css, screenKit,
home, gameWizard, game, inputs, prompts, mapExplore, hamburgerMenu,
settings) and screenshotted the running GeoQuiz (home, wizard, map-click
round, multiple-choice result, map explore) before changing anything.

Now matching it: dark palette and button styles; Games / Explore /
Settings home; GeoQuiz's wizard wording with counts and a final
"Either side, or left and right separately?" step (its sovereignty
step's role); "Round / Score / timer / action / ☰" header with Restart /
Back / Home; the floating overlay for click rounds; answers below the view
otherwise; green/red locked option buttons; autocomplete on typed answers;
GeoQuiz's feedback wording (plus the other-language name); "Game Over"
summary listing every round; Explore with "Tap a bone", Random and an info
card; a Settings screen (keep or reset the view between rounds). Viewer
highlight colours switched to GeoQuiz's accent blue, green and red. Details
are in DESIGN.md, "Interface: GeoQuiz's, screen by screen".

Behaviour carried over too: click anywhere to advance via one screen-wide
listener (the earlier `onNext` widget callback is gone), and ☰ → Back
returns to the wizard's last step with history intact (the wizard's steps
became named objects to make that possible).

Checked in Firefox at desktop and phone sizes: every screen above
screenshotted; settings persist across reloads; ☰ → Back → Back → Back
walks sides → sub-region → region; a drag on the 3D view doesn't advance
but a click on the header does; opening or closing ☰ during a result
doesn't advance; clicking a locked option or the read-only input
advances; a typed game played through to the summary; no console errors.
Fixed along the way: "Choose a upper limb region" → "an".

## 2026-10-06: clicking an option after the result advances

User request: in multiple choice, once the result is showing, clicking the
option buttons should go to the next round, like clicking the skeleton.
They were `disabled` after confirming, and browsers fire no click on
disabled buttons. Options now lock with an `is-locked` class and call the
game's new `onNext` widget callback. The hover accent is skipped on locked
options, so it doesn't recolour the green/red result borders. I first also
set `aria-disabled`, then removed it: the button isn't disabled any more,
and Playwright (rightly) refused to click it. Checked in Firefox: clicking
the green, red or a neutral option advances, Enter on the focused option
advances, and the confirming re-click never skips ahead.

## 2026-10-06: full read-through, 13 fixes

User asked for a couple of complete read-throughs checking for errors.
Read every source file, script and config, then verified each fix
(Node logic checks, plus Firefox via Playwright against the dev server
and the production build).

Found and fixed:

1. **Head & neck → "All of it" included the ear ossicles**, which can't
   be clicked inside the opaque temporal bone (the reason they were
   already excluded from Whole skeleton). Children can now be
   `standalone` (left out of the parent).
2. **Right-click selected bones.** Only the primary button picks now.
3. **Two-finger gestures could count as a click** (and advance a round).
   A press is a pinch once a second pointer goes down.
4. **Hover lit bones and showed a pointer cursor in typed and multiple-
   choice rounds**, where clicking does nothing. The guard
   (`hoverHandler !== undefined`) was always true. Hover now runs only
   with a hover group or handler.
5. **Enter stopped working after a multiple-choice answer**: focus stayed
   on the now-disabled option button, and the key handler skipped all
   buttons.
6. **English↔Latin questions gave the answer away** for 15 bones with
   identical names (Humerus, Stapes, …), and in typed name→latin for the
   vertebrae (Latin synonym "Vertebra T4"). These are filtered out by the
   new shared `core/pool.js`.
7. **Regions left empty by that filter** (Ear ossicles in English↔Latin)
   would have started a game with no rounds. The wizard now disables them,
   and the game shows a message as a fallback.
8. **`spellcheck: false` was silently dropped** by `h()`, which skipped
   every `false` prop. Properties now get `false`; attributes are still
   omitted.
9. **The wizard showed "Loading…" forever** if the data failed to load.
10. **No favicon**, so every page load 404ed. Added `public/favicon.svg`.
11. **`deploy.sh` could watch the previous run** if GitHub was slow to
    register the new one. It now waits for a newer run id.
12. **The export now checks its material names** too (same `.001` trap
    as object names). Re-ran it: outputs are byte-identical.
13. **The summary nested `<main>` in `<main>`.** It's a div now.

Also: the accent-stripping regex in `answers.js` contained invisible
literal combining characters. It worked, but is now written as
`\u0300-\u036f`. `dataset.js` reads `import.meta.env?.BASE_URL` so the
core modules load in Node for logic checks.

Verified: 12/12 targeted Firefox checks, a full 6/6 ossicles game at
phone size, production-build Explore, and region/pool counts in Node.


## 2026-10-06: bones outside the region: very pale and see-through

User request: when playing a region (e.g. the head), the rest of the
skeleton should be "very pale translucent". It was 12% opacity in the
normal bone colour, with no depth write, so overlapping bones stacked
into grey. Now: near-white, 7% opacity, mostly flat (emissive), and drawn
nearest-first with depth write on, so only the front surface shows and
overlaps don't build up (DESIGN.md "Regions"). Checked in Firefox:
head & neck at normal and zoomed-out views, and the ear-ossicles region
(ossicles still fully visible inside the ghosted skull).


## 2026-10-06: v1, a 3D skeleton quiz

The user chose a 3D viewer and the skeleton as the first scope. Blender
5.2 turned out to be installed after all (`~/.local/bin/blender`, set up
that day after the first environment check), which made a headless export
pipeline possible.

**Data.** Surveyed both `.blend` files and picked the full atlas
(`Startup.blend`, unzipped from the template zip) over the Biomechanics
file, which is rigged and has messy names. `scripts/export-skeleton.py`
exports the skeleton's 269 objects (8 sub-part meshes handled: 6 ethmoid
air cells merged in, 2 sinuses dropped), with modifiers applied and
decimated 700k → 205k triangles, as a 0.89 MB Draco GLB. Rendered it
headless in Blender before going further: the whole skeleton is intact at
real scale (1.7 m). `scripts/generate-data.mjs` joins names to
`Translations0.txt`; all 269 items and 32 groups have English and Latin
names plus synonyms.

**App.** three.js viewer, attribute/region/engine core, wizard, game and
Explore screens. Six modes (any pair of name / Latin name / location),
typed or 2–6 multiple choice, left/right merged or separate, 15 selectable regions.
See DESIGN.md for the full design.

**Verified in Firefox (Playwright, the user's browser):**

- Explore: hover tooltip, click → info panel.
- Name→location on the hand: jittered clicks select, re-click confirms,
  right and wrong both scored, a stage click advances, feedback hides
  between rounds.
- Location→name typed on the skull: uppercase input accepted, wrong
  input rejected.
- Latin→name multiple choice on the thorax.
- A complete ear-ossicles game, sides must match, at 390×844 (phone):
  6/6, then the summary.
- The production build via `vite preview`.
- Typed-answer matching: 13 Node cases, including sides, Latin side
  words, "Vertebra L1" (not a side), T4≠T5, accents.

**Bugs found by actually running it, each fixed:**

- Every click resolved to nothing: Blender named the export copies
  `Femur.l.001` because the source objects still held the names. The
  export now renames sources first and fails loudly on a mismatch.
- Blender's bundled Draco library wasn't found headless; fixed with
  `LD_LIBRARY_PATH` in the npm script.
- Feedback from the previous round stayed on screen: `.feedback {
  display: flex }` beat the `hidden` attribute. Added a global
  `[hidden] { display: none !important }`.
- A literal "null" appeared in the feedback and the Explore panel:
  `replaceChildren()` stringifies `null` (the `h()` helper filters it, but
  these calls bypassed `h()`).
- The ossicles were near-unclickable. Result framing used a fixed 12 cm
  context, which left a whole-head view for the next round, where a
  stapes is one pixel. Context now scales with the region, and the
  player's own view is restored at the start of each round.
- Clicks on tiny bones missed when the mouse drifted 1–2 px between
  press and release. Picks now resolve at the press point, with a
  ring-search assist on a miss (10 px for a mouse, 20 px for touch).
- Draco decoder: first copied by an npm pre-script. three r186's
  `DRACOLoader` exports `DRACO_GLTF_CONFIG`, which Vite bundles itself,
  so the copy step was removed.


## 2026-10-06: first deploy, live at zigakorosak.com/anatomyquiz/

The user created the cPanel FTP account `ftpaccanatomyquiz@zigakorosak.com`
(its own account, not GeoQuiz's, which is locked to `public_html/geoquiz`;
reusing it with `server-dir: ./` would have overwritten GeoQuiz) and set
the three repo secrets. cPanel's truncated path column didn't show whether
the account's folder was inside `public_html`. The deploy settled it: the
workflow passed, and fetching the live URL (via the www redirect) returned
the app's page, with its JS and CSS assets both 200. GeoQuiz still returned
200 afterwards.

Annotation on the run: `actions/checkout@v4` and `actions/setup-node@v4`
target the deprecated Node 20 runtime (GitHub forces Node 24). Harmless
for now.

## 2026-10-06: pushed to GitHub

Remote: `https://github.com/zigakorosak/anatomyquiz` (public, like
GeoQuiz). The repo already existed, empty, created earlier the same day;
checked that it had no commits before pushing to it. Set a repo-local git
identity matching GeoQuiz's commits (`Ziga Korosak
<ziga.korosak@gmail.com>`), since none was configured on this machine.

## 2026-10-06 — project scaffolded from the GeoQuiz setup

Set up the environment to mirror GeoQuiz, based on its docs in
`reference/` (the GeoQuiz code itself isn't in this folder):

- Vite + vanilla JS app shell (`index.html`, `src/main.js` screen router,
  placeholder `ui/home.js`, `style.css`). `vite.config.js` uses
  `base: "/anatomyquiz/"`. Verified in a real build that the script and
  link tags resolve to `/anatomyquiz/assets/...`, and that the dev server
  serves the page at `/anatomyquiz/`.
- `scripts/`: `archive.sh` (via `npm run archive -- <label>`),
  `git-push.sh`, `deploy.sh`, `push-deploy.sh`, `archive-p-d.sh`. These are
  rewritten from GeoQuiz's description, not copied. `archive.sh` also
  excludes `reference/`; a test archive came out at 20 KB with no
  `reference/` entries.
- `.github/workflows/deploy.yml`: manual-only, FTPS to Namecheap,
  `server-dir: ./`. It has not run yet; it needs the GitHub repo and FTP
  secrets first (see DESIGN.md "Deployment").
- `.gitignore` covers `node_modules`, `dist`, `archive`, `reference`
  (2.3 GB of CC-BY-SA source data), scratch scripts and `.env*`.
- `git init` on `main`.
- Surveyed the Z-Anatomy data and documented it in DESIGN.md "Data &
  license". The main open decision is 3D vs. 2D vs. text-first.
