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
- No backend. Fully static; data is fetched from `public/data/*.json` at
  runtime, using an `import.meta.env.BASE_URL` prefix so it resolves under
  `/anatomyquiz/`.
- Rendering library: **not chosen yet** (see "Open decisions").

## Architecture (planned, mirroring GeoQuiz)

```
src/
  core/
    attributes.js   — attribute registry (name, location, system, latin name, …)
    datasets.js     — dataset registry (items + model/image + applicable attributes)
    engine.js       — QuizSession: generic round/scoring logic
    settings.js     — persistent preferences (localStorage)
  ui/
    home.js         — main hub
    gameWizard.js   — sequence of choice screens
    game.js         — round loop
    prompts.js      — prompt widget registry
    inputs.js       — answer-input widget registry
  main.js           — top-level screen router
scripts/
  generate-data.mjs — builds public/data/*.json from reference/ (to come)
```

Only `main.js`, `ui/home.js` and `style.css` exist so far.

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
- `Z-Biomechanics/`, `Z-Anatomy_Template/`: the full `.blend` atlas.
  Blender is **not installed** on this machine.

**License:** CC-BY-SA 4.0 (Z-Anatomy), derived from BodyParts3D
(CC-BY-SA 2.1 Japan). Anything shipped that is derived from this data
(names, geometry, renders) must carry attribution to both and be shared
under the same license. The app needs a visible credits/attribution line.
Attribution strings, as Z-Anatomy specifies:

- "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
- "Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0"

## Open decisions

- **How structures are shown/clicked.** Options: (a) a 3D viewer
  (three.js) on decimated glTF/GLB converted from the FBX files, (b)
  pre-rendered 2D views (SVG/PNG plus hit masks) per body region, or (c)
  text-only modes first (name ↔ Latin, name ↔ system, multiple choice).
  (a) is closest to the source data but means building a conversion and
  decimation pipeline without Blender. (c) can ship first regardless.
- **Initial scope**: which systems/collections to start with (bones are
  the smallest clean set: `Collections - Bones.csv`, SkeletalSystem100.fbx).

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
  triggers the manual deploy workflow and waits for pass/fail.
  `scripts/push-deploy.sh "msg"` runs both, and
  `scripts/archive-p-d.sh <label> "msg"` archives first.
- **Scratch scripts**: `scratch-*.mjs` in the project root (gitignored),
  deleted in the same turn they're finished with.
- **Generated data**: `public/data/*.json` is generated by scripts from
  `reference/`, never hand-edited.

## Deployment

Target: `zigakorosak.com/anatomyquiz/` on Namecheap shared hosting
(cPanel), the same host as GeoQuiz. `.github/workflows/deploy.yml` builds
on GitHub's runner and FTPS-uploads `dist/`. It is **manual only**
(`workflow_dispatch`): run it from the Actions tab or with
`gh workflow run "Deploy to Namecheap"`.

`vite.config.js` sets `base: "/anatomyquiz/"`. If the deploy path changes,
that line must change to match.

**One-time setup, not done yet:**

1. Create the GitHub repo and push.
2. In cPanel, create an FTP account scoped to `public_html/anatomyquiz`.
3. Add repo secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.

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
  browser. Playwright can install Firefox (`npx playwright install firefox`)
  for real-browser checks.
- Blender is not installed, so the `.blend` files can't be read directly.
