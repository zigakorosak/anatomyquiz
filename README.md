# Anatomy Quiz

A browser anatomy quiz for [zigakorosak.com/anatomyquiz](https://zigakorosak.com/anatomyquiz/),
built the same way as [GeoQuiz](https://zigakorosak.com/geoquiz/): pick
what's shown and what you have to answer, and play through rounds.

## Features

- A 3D human skeleton (269 bones, cartilages and teeth) you can rotate,
  zoom and click.
- **Six quiz modes**: any pair of name, Latin name and location, e.g.
  "find the scaphoid" (click it), "name the highlighted bone" (type it or
  pick from 2–6 options), or Latin ↔ English.
- **Left and right**: merge pairs ("Femur", either one counts) or quiz
  each side separately.
- **Regions**: the whole skeleton, or head & neck, trunk, upper limb or
  lower limb, each with sub-regions down to the hand, foot, teeth and
  ear ossicles. Bones outside the region fade out.
- Every answer shows the right bone in green and your pick in red, with
  English and Latin names.
- **Explore** mode: hover for names, click for Latin name, synonyms and
  group.

## Tech stack

Vanilla JavaScript (ES modules), no UI framework. [Vite](https://vite.dev/)
for the dev server and build. [three.js](https://threejs.org/) for the 3D
view. No backend: fully static, with the model and item data read from
`public/data/` at runtime.

Anatomy data comes from [Z-Anatomy](https://www.z-anatomy.com/), itself
derived from BodyParts3D (see "Data & license" in `DESIGN.md`).

## Getting started

```bash
npm install
npm run dev       # dev server at http://localhost:5173/anatomyquiz/
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

### Regenerating game data

The model and item data are generated from the Z-Anatomy atlas in
`reference/` (local only), not hand-maintained:

```bash
npm run export-skeleton   # Blender (headless): public/data/skeleton.glb + data/skeleton-objects.json (~1.5 min)
npm run generate-data     # Node: public/data/skeleton.json (names, Latin, synonyms, groups)
```

Needs Blender 5.x on the PATH and `reference/Z-Anatomy_Template/Z-Anatomy/Startup.blend`
(unzip it from `Z-Anatomy.zip`). The outputs are committed, so building and
deploying don't need either.

### Archiving a snapshot

```bash
npm run archive -- <short-label>
```

Tars the project (excluding `node_modules`, `dist`, `archive`, `reference`)
into `archive/<timestamp>_<label>.tar.gz`, keeping the 10 most recent.

## Deployment

Deploys are **manual only**. Pushing to `main` does not trigger anything.

```bash
gh workflow run "Deploy to Namecheap"   # or scripts/deploy.sh, which also waits for the result
```

The workflow (`.github/workflows/deploy.yml`) builds the site and
FTPS-uploads `dist/` to Namecheap shared hosting at
`zigakorosak.com/anatomyquiz/`.

## Project structure

```
src/
  core/       — dataset, attribute/region registries, answer matching, quiz engine
  viewer/     — three.js skeleton viewer
  ui/         — screens: home, wizard, game, explore
  main.js     — top-level screen router
public/data/  — generated model + quiz items (CC BY-SA)
data/         — intermediate export from Blender
scripts/      — Blender export, data generation, archive and release scripts
reference/    — Z-Anatomy source material (local only, gitignored)
```

## License of the anatomy data

The 3D model and names come from [Z-Anatomy](https://www.z-anatomy.com/)
(CC BY-SA 4.0), which is based on
[BodyParts3D](https://lifesciencedb.jp/bp3d/), © The Database Center for
Life Science (CC BY-SA 2.1 JP). The generated files in `public/data/` and
`data/` are shared under CC BY-SA 4.0.

## Docs conventions

Four markdown files, each with one job: this README (outward-facing intro),
`DESIGN.md` (architecture), `LOG.md` (chronological change history), and
`MISTAKES.md` (process lessons). Don't add further `.md` files; extend these.
