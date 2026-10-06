# Anatomy Quiz

A browser anatomy quiz for [zigakorosak.com/anatomyquiz](https://zigakorosak.com/anatomyquiz/),
built the same way as [GeoQuiz](https://zigakorosak.com/geoquiz/): pick
what's shown and what you have to answer, and play through rounds.

**Status:** environment scaffolded, no game yet. See `DESIGN.md` for the
plan and open decisions.

## Tech stack

Vanilla JavaScript (ES modules), no UI framework. [Vite](https://vite.dev/)
for the dev server and build. No backend — fully static, data read from
`public/data/*.json` at runtime.

Anatomy data comes from [Z-Anatomy](https://www.z-anatomy.com/), itself
derived from BodyParts3D (see "Data & license" in `DESIGN.md`).

## Getting started

```bash
npm install
npm run dev       # dev server at http://localhost:5173/anatomyquiz/
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

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
  core/       — data/attribute registries, quiz engine (to come)
  ui/         — screens
  main.js     — top-level screen router
public/data/  — generated quiz data
scripts/      — data generation, archive and release scripts
reference/    — Z-Anatomy source material (local only, gitignored)
```

## Docs conventions

Four markdown files, each with one job: this README (outward-facing intro),
`DESIGN.md` (architecture), `LOG.md` (chronological change history), and
`MISTAKES.md` (process lessons). Don't add further `.md` files; extend these.
