# Project Log

Newest first. What changed and why.

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
