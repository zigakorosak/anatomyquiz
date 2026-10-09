# Project Log

Newest first. What changed and why.

## 2026-10-09: Muscles, and the checks that came with them

User request: add muscles, run every check (caps in cut mode and so on),
and use MISTAKES.md from bones and attachments to look for similar issues.

Added:
- **Export**: 464 muscles from "4: Muscular system" (bursae, fasciae,
  sheaths, retinacula, standalone tendons left out), Subdivision skipped,
  decimated to 317k triangles, `muscles.glb` 1.77 MB, with tendon parts.
  Sides checked against geometry (0 disagree; the export fails if one
  ever does); "Iliocostalis colli muscle" (unsided) relabelled left.
  Bones each muscle lies on, for the game's backdrop.
- **Data**: `muscles.json`, all names translated, the same failure checks
  as the attachments plus id clashes.
- **Subject** "Muscles" in Games (name / Latin / location, their own
  region tree from the atlas's muscle groups, "Location on the body") and
  in Explore (card with action; selection x-ray; layers follow the shown
  subjects).

Found and fixed along the way, each by measuring:
- **Tendons and articular cartilage were never exported** as their own
  material: `materials.clear()` in Blender 5 resets every face to slot
  0. Since the first bone export, 232 bones' joint cartilage was drawn
  as bone. Now replaced slot by slot: cartilage shows pale blue, tendons
  silver. Skeleton 0.89 → 1.18 MB.
- **Cracks between a structure's parts**: Draco quantizes each part
  separately, leaving ~25 µm seams that break cap counting. The viewer
  welds them at load (topology check back to the single-part numbers).
- **Muscle mesh defects** (topology check: open edges, non-manifold
  edges, pieces, volume per piece): specks, duplicated faces (longus
  colli), inside-out pieces. `seal(clean=True)` for muscles. Bones and
  patches had none of these.
- **Caps**: counting now per structure (all parts together), and where
  structures overlap the first cap drawn claims the pixel (bones, then
  patches, then muscles), with picking in the same order. Overlapping
  muscle caps had z-fought.
- **Stripes on every cut face**: the faint plane marker sat at exactly
  the caps' depth. Pushed a hair behind with a polygon offset. Bones had
  this too; seen only once a debug-palette render hid the marker.

Verified in Firefox:
- **Caps**: every bone, patch and muscle cut on 3 planes. See-through only
  at real openings and real ring-shaped sections. Whole body, bones +
  muscles, 6 cuts: 1,214 of 1,215 cut-face points pick exactly the drawn
  structure (the other sits on the midline seam between the two latissimus
  dorsi).
- **Reachability**: in its own region game (backdrop bones, layers), each
  of the 464 muscles is clickable: 138 at once, 322 after one layer, 4
  after two.
- **Games**: click (right and wrong), a typed answer on a highlighted deep
  muscle, multiple choice, and the report. The Latin game drops the 27
  identical-name pairs.
- **Explore**: mode switching (no stuck white ghosts), one ghost layer (alpha
  p95 = median), hover names, the popup at 360 px.
- **Controls**: bones and attachments games unchanged.
- **Render time**: 6.5 ms with all muscles; 17 ms for a full-body cut capping
  87 structures (software WebGL).

## 2026-10-09: Explore subjects popup with four modes

User request: Subjects opens a popup in the middle of the screen, and the
button beside each subject cycles Off → Outline → Visible → Clickable.

- `ui/explore.js`: the checkbox dropdown is replaced by a centred popup
  (Done / Escape / click outside close it). Modes map onto the viewer:
  Off → hidden, Outline → muted ghost, Visible → backdrop, Clickable →
  playable. Bones start Clickable, attachments Off.
- Viewer: `setHidden(ids)`, a set of meshes not drawn at all; patch
  visibility (`showPatches`) and it share one `_updateVisibility()`.
  `reset()` clears it.
- How to play, README and DESIGN updated.

Tested in Firefox: every mode of both subjects gives the expected counts
(bones Off 0 drawn; Outline 269 ghosts; Visible 269 solid, 0 clickable;
Clickable 269 clickable; attachments likewise, 728). A click on the femur
picks it only when bones are Clickable. The popup is centred, fits at
360 px, and a subject leaving Clickable clears its info card.

## 2026-10-08: cut faces solid even with something inside (sternum)

User report: with a sagittal cut, the costal cartilage could be seen and
selected through the body of the sternum, which had no cap. Cause: the
cartilages' tips overlap into the sternum's volume, and the caps were the
bone's far inner wall, so anything inside drew in front of them and took
the click. Measured over the sternum's cut face first: 78 of 295 points
picked a costal cartilage and 9 the manubrium.

- First try, the cap shader writing the plane's depth (gl_FragDepth):
  fixed the sternum but flattened every bone beyond the plane into a
  silhouette (a fragment can't know whether its ray crossed the plane
  inside the mesh). Dropped.
- Then stencil capping (DESIGN.md "Bottom toolbar → Caps"): per mesh the
  plane crosses, count front/back faces on the stencil, then draw a quad
  on the plane where the count is non-zero. Picking picks the mesh the ray
  is inside of at the plane.
- That exposed a real bug: `boxOf()` used `Box3.expandByObject`, which
  includes children, so the oversized cap quads inflated a capped bone's
  box and framing zoomed out. It now measures the meshes' own geometry.

Result:
- All 295 points over the sternum's cut face pick the sternum, and the
  screenshot shows a solid cut face.
- All 997 meshes cut on 3 planes show see-through only at real openings
  (3 ring-shaped patch sections fill with their bone shown: 0 px).
- Cut behaviour is unchanged.
- A sagittal cut caps 45 meshes; render time 3.7 → 5.8 ms per frame in
  software WebGL.

One test slip on the way: the first patch sweep ran with attachments
switched off, so the patches were ghosts (no caps by design) and looked
"open". Rerun with them in play.

## 2026-10-08: no more seeing inside bones (left clavicle)

User report: "I can see inside the left clavicle". The clavicle's mesh is
closed with consistent winding, its outside looked solid from three
directions, and cuts through it capped correctly. So the cause was the
camera itself: inside or right against a bone (common while orbiting a
pivot deep in the body, since zoom goes towards the cursor), a bone is
drawn hollow, because only its outward faces are drawn. Reproduced by
putting the camera 2 mm inside the clavicle: without caps you see out
through it; with caps it's solid. Caps are now always drawn for solid
meshes, not only while cutting, and the near plane is 2 mm (was 1 cm).
Normal view unchanged (3 of 270,000 pixels differ), and render time
unchanged.

Also found: a winding check (edges traversed the same way by two faces)
flags 25 meshes, the ethmoid by far the most (2,447 of 3,996 triangles,
likely the merged air cells overlapping its body). With caps always on,
such faces show solid instead of open. Not investigated further.

## 2026-10-08: every bone and attachment gets a cut cap

User request: make sure all bones and attachments get a cap when cut.
Patches had no caps at all; now every mesh does. Caps (back faces seen
through the cut) need closed, outward-facing meshes, so I measured:
- 14 bones and 6 patches had open edges (welded by position in the
  browser).
- 2 patches (temporalis "o3") were inside out (negative signed volume).

The exporter now seals every mesh after decimation (`seal()`: fill holes,
recalculate normals, flip if the signed volume is still negative). It
filled holes in 13 bones (occipital 40 open edges, T8 26, ethmoid and
frontal 20, …) and in the 6 patches. After that, 0 meshes are inside
out. The few remaining "open" edges in the browser check are 2-edge
hairline cracks: Blender sees those meshes as closed, and they can't show.

Then a pixel test of the actual result: each of the 997 meshes alone, cut
through its centre on all three planes, viewed into the cut, counting
background pixels enclosed by the section. Every section was filled
except real openings (vertebral canal, sacral foramina, sphenoid
foramina, maxillary sinus opening, gaps between separate parts of one
mesh). One-sided cases were compared with their mirror twins by
screenshot. Three ring-shaped patch sections read 0 once their host bone
was shown. A rerun of the patches alone also read 0, unlike the sweep's
179–338 px; the sweep recoloured materials, which is the likely
difference. The skeleton GLB changed (sealing adds 34 triangles); sizes
are unchanged at 0.89 MB and 0.91 MB.

## 2026-10-08: Explore opens straight in; subjects as toggles

User request: Explore should put you straight in, with a Subjects button
that opens a list of toggleable subjects (bones, attachments; muscles and
more later). The subject choice screen is gone. Bones are on to start. The
Subjects dropdown has one checkbox per subject from the registry. Any mix
can be on: the enabled subjects' meshes are clickable; bones become a solid
backdrop when only other subjects are on; with nothing on, everything
ghosts. Attachments load the first time they're turned on. The label,
Random and the info card follow what's on. ☰ lost "Back", which led to the
removed choice screen. See DESIGN.md "Interface → Explore". How to play
mentions Subjects.

Checked in Firefox:
- It opens straight into the view ("Tap a bone").
- Bones + attachments: 997 clickable meshes. A click on a patch gives the
  attachment card, and a click on bare bone gives the bone card (Femur).
- Attachments only: 269 backdrop bones, only patches clickable, and the
  bone selection is cleared.
- Nothing on: nothing clickable, and Random is disabled.
- The list closes on an outside click, and Random works.
- The header and list fit a 390 px phone.
- No console errors.

## 2026-10-08: How to play

User request: a home-screen button explaining how the game works. Home is
now Games / Explore / How to play / Settings. The page (`ui/helpScreen.js`)
has six short sections. The gestures were taken from OrbitControls'
actual defaults (left-drag turns, wheel zooms towards the pointer,
right-drag pans; one finger turns, two pinch and pan), not assumed.
Checked in Firefox at 1000 px and 390 px: the page scrolls inside itself
(the page never scrolls), Back returns home, and there were no errors.

## 2026-10-08: faint plane showing where the cut is

User request: a very low opacity plane at the cut. A quad in the accent
blue at 8% opacity, on the cut plane and spanning the region (+10%); not
clipped or clickable, only shown while cutting. Checked in Firefox for all
three planes: the quad lies on the cut plane and faces along its normal,
it's sized to the region's other two axes, clicking still works, and it
hides when Cut is turned off. Screenshots show it faint but visible (a
sheet across the hips for a transverse cut).

## 2026-10-08: plane cut

User request: a button that turns on a plane cut, with three plane buttons
(pressing the same one again flips direction) and a slider that moves the
plane; everything on one side is hidden. Built as a bottom toolbar
(`ui/viewTools.js`) holding the layers button and "Cut". The viewer uses a
shared clipping plane on every material, back-face "caps" so cut bones
look solid, and cut-aware picking (hidden side ignored; a click on a cut
face picks that bone). See DESIGN.md "Bottom toolbar".

Checked in Firefox (Explore and a game):
- Cut on gives sagittal, "right hidden"; the right femur becomes
  unclickable and the left stays clickable. Pressing Sagittal again shows
  "left hidden" and swaps them.
- Transverse at 85% keeps the skull and cuts the femur away.
- A click on the sternum body's cut face picks the sternum body.
- Cut off removes the clipping.
- In a game, using the toolbar during a result doesn't advance, and the
  cut stays on into the next round.
- The toolbar fits a 390 px phone.
- No console errors.

Two slips caught by the screenshots:
- The inactive plane buttons said "Coronal null". `replaceChildren` with a
  `null` again, the third time.
- An apparent double highlight was a screenshot taken mid-way through the
  buttons' 0.15 s colour transition; settled styles are correct.

A grep for `replaceChildren(` with a conditional argument (now in
MISTAKES.md) found one more latent case in Explore's bone card (the group
subtitle). No bone triggers it today; fixed anyway.

## 2026-10-08: layers button instead of the slider

User request: a button at the bottom instead of the slider. Each press
removes one layer, and on the last layer a press goes back to all layers.
`ui/layerSlider.js` became `ui/layerButton.js`: a pill reading "Remove a
layer 4/5", or "Show all layers 1/5" on the last layer. Layer measuring is
unchanged. Checked in Firefox:
- Explore cycles 5/5 → … → 1/5 → 5/5.
- Skull: one press ghosts the frontal bone, the next brings it back.
  Pressing during a result doesn't advance, and the state carries into the
  next round.
- Hand: no button.
- It sits above the credits line in Explore and fits a 390 px phone.
- No console errors.

## 2026-10-07: muscle attachments on the wrong side, or on one side only

User report: the serratus posterior inferior insertion is only on the right
side; look for similar issues. Checked every patch's side label against
its host bone, then against the geometry (which side of x = 0 it lies on).
The atlas's labels were unreliable in three ways:
- Swapped pairs: the patch labelled left is on the right and vice versa
  (scalenes, rectus capitis origins and insertions, piriformis and
  procerus origins, …). Harmless with "either side", wrong with "left and
  right separately".
- One side only: 12 attachments existed on the right only, labelled left
  (serratus posterior inferior and superior insertions, pectineus,
  piriformis and short head of biceps femoris insertions, plantar
  interossei, pronator quadratus, procerus insertion, short head of biceps
  brachii origin, two serratus anterior digitations).
- Wrong host: 2 patches on the left bone were parented to the right one
  (popliteus origin, rectus abdominis origin).

Fixed in `export-models.py` (DESIGN.md "Data pipeline"): relabel from
geometry, re-host, and mirror one-sided attachments onto the opposite
bone with Shrinkwrap. Result: 55 relabelled, 2 re-hosted, 23 mirrored
(705 → 728 patches). `generate-data` now fails on any attachment with
unequal sides.

The first version treated patches within 5 mm of the midline as "on the
midline" and kept their labels. The new equal-sides check caught the
procerus insertion as still one-sided. Listing every patch near the
midline showed paired patches as close as ±1.4 mm, two more swapped pairs
hidden by that zone (rectus capitis posterior major and minor insertions),
and that the procerus patch had been wrongly re-hosted. The zone is now
1 mm, with the host bone's side as the tie-breaker. Skeleton outputs stayed
byte-identical through both exports.

Verified in Firefox:
- 0 side labels and 0 hosts disagree with the geometry.
- All 23 mirrored patches are clickable.
- They sit on their bones as well as the originals (on-bone probe 41–68%
  vs 45–73% for the originals they came from).
- Screenshot: serratus posterior inferior, 4 patches on each side, ribs
  9–12.

## 2026-10-07: muscle attachments (origins and insertions)

User: "start working on muscle insertions". Surveyed the atlas's
"2: Muscular insertions" collection first: 705 patches, 167 muscles, 351
origins and 354 insertions, parented to their bones, named
`<muscle>.<o|e><part?><side>`, with action materials. Asked the user three
design questions. Answers: the quiz is "find the attachment" (shown
the name, click it); origins and insertions are separate items; it's a
subject step in Games, and in Explore too.

- **Export**: `export-skeleton.py` became `export-models.py`, exporting
  both models in one Blender run. The skeleton outputs are byte-identical.
  Patches skip Subdivision (931k → ~174k triangles), get a 1 mm shell, and
  are decimated 50% to 89k triangles (0.88 MB). `generate-data` writes
  `insertions.json`: 235 attachments, every host bone verified, one Latin
  override.
- **Viewer**: loads the patch model on demand. New *backdrop* (solid, not
  clickable, but blocks clicks), patches drawn amber with a polygon offset,
  face-on framing for attachments. Also fixed `frame({animate: false})`,
  which didn't cancel a running glide.
- **Subjects**: new `core/subjects.js`. The wizard and Explore start with a
  subject choice, steps with a single option are skipped, and region
  membership comes through the host bones. `buildQuizItems` merges an
  attachment's parts, and keeps `members`.
- **Layers slider** in attachments mode peels bones only. Peeling patches
  with their bone was tried first and left 2 attachments unreachable (see
  DESIGN.md "Subjects").

Verified in Firefox:
- Every patch was framed and clicked from 6 directions: 699/705 are
  clickable outright, and all 705 after peeling 2 layers.
- A bone in front of a patch blocks the click.
- A full Vertebral column attachments game played to the report: 14/14.
- Explore attachments: Random shows the card (bone, action, side).
- Bones mode is unchanged: the game works, and patches are hidden.
- No console errors.

Fixed along the way: the wizard's left/right examples said "Femur" for
attachments too. They're per subject now.

## 2026-10-07: no tiny layers in the layers slider

User: in the Skull, the last layer (only the ethmoid) isn't needed; check
for the same elsewhere. Printed every region's layers: the same pattern
appeared in Foot (two cuneiforms last), Lower limb (cuneiforms + navicular
last), Head & neck, Whole skeleton and Explore (the lone ethmoid), and
Explore had an odd middle layer of incus, malleus and one incisor. Tried a
"hidden from most directions" measure first; it couldn't separate these
from layers that matter (vertebrae behind ribs 32% vs the lone ethmoid
29%). The separating feature was size: every pointless layer had 1–3
structures, every useful one 4+. New rule: a layer needs at least 4
different structures (left/right count once); smaller ones merge inward,
or outward if innermost. Now: Skull 2 layers (outer 9 → inner 6), Foot 2,
Lower limb 2, Head & neck 4, Whole skeleton 6, Explore 5; Trunk and Upper
limb unchanged. Checked in Firefox: the Skull slider shows 2/2, and at 1/2
exactly the six inner bones are solid. No console errors.

## 2026-10-07: layers slider; ghosts that stayed solid white

User request: a slider at the bottom that, when lowered, hides the
outermost structures so the ones inside are easier to click. The user
wrote "opaque". Implemented as see-through (the pale ghost) and
unclickable, since opaque would hide the inside; flagged to the user.
See DESIGN.md "Layers slider". Layers are measured per region by
depth-peeled exposure with Otsu splits, calibrated on printed per-round
exposures for skull, trunk, hand, foot, teeth and the whole skeleton. Two
earlier measures were rejected on that data: median layer (put the skull
vault a layer deep) and a fixed threshold (no single value fits skull and
trunk).

Bug found while testing the slider, and fixed: a bone first drawn solid
stayed **solid white** when it should have become a ghost. three bakes
`transparent: false` into the shader (alpha forced to 1), and `_apply`
flipped `transparent` without `needsUpdate`. It wasn't only the slider: open
Explore, then start any region game, and every bone outside the region was
solid white. That happened on the live site, and is very likely what was
behind the earlier "the head should go transparent like the rest" report.
Reproduced (Explore → Hand game), fixed, and re-shot: ghosts again.

Checked in Firefox:
- Skull: the slider shows 4/4. At 1/4 the frontal bone is ghosted and
  unclickable, and only the ethmoid is solid.
- Using the slider during a result doesn't advance, and its position
  carries into the next round.
- Hand: no slider.
- Explore: 7 layers. The slider sits above the credits line on desktop and
  on a 390 px phone.
- No console errors.

## 2026-10-06: report buttons ignore clicks for 0.5 s

User report: after clicking Next on the map at the end, a quick second
click seemed to press something on the report. That's very likely the
"ear ossicles has no report screen" report too. A short game has a short
round list, so the report's buttons sit across the middle of the screen
(at 1000×800: Play Again y297–340, Back y356–399, Home y415–459), right
where you click the 3D view to advance. A second click there started a new
game or left before the report was seen. The report's buttons now ignore
clicks for 500 ms (`REPORT_GUARD_MS`, via `pointer-events: none` on a
class, so they don't dim or flicker). Checked in Firefox at 1000 px and
390 px: a double click on "See Results", and a double click on the middle
of the 3D view, both leave the report up; Play Again works after the
window.

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
