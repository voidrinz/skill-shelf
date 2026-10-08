# Website Deployment

The product website is hosted at <https://voidrinz.github.io/skill-shelf/>.
It is a static React/Vite build; installers are downloaded directly from the
public `voidrinz/skill-shelf-releases` repository.

## GitHub Pages

In the source repository, set **Settings > Pages > Source** to **GitHub Actions**.
The `Deploy Website` workflow builds only the website and its shared packages,
then publishes `website/dist` with the base path supplied by GitHub Pages.
This also supports moving to a custom domain without hard-coding `/skill-shelf/`.

Deployment runs on relevant changes to `main`, manually from Actions, and daily
at 01:23 UTC. Desktop packaging still starts only when a stable `v*` tag is pushed.
After the desktop release request, a separate job waits for the installers to
be public before triggering a website deployment. If a release takes longer
than 20 minutes, rerun that job or run `Deploy Website` after publication.

## Direct Downloads

During deployment, GitHub's latest stable release is read with the workflow's
temporary `GITHUB_TOKEN`. The two published DMG assets are validated and their
URLs are written to the ignored `website/.env.production.local` file. The token
never enters the website bundle. Visitors click regular attachment links;
there is no GitHub release-page redirect or browser-side API request.

Local development defaults to the existing v0.1.1 installers. To preview with
current downloads, run:

```sh
gh api repos/voidrinz/skill-shelf-releases/releases/latest | node website/scripts/prepare-downloads.mjs
pnpm --filter @skill-shelf/website build --base /skill-shelf/
pnpm --filter @skill-shelf/website preview --base /skill-shelf/
```

Updating the website does not create a desktop release or rebuild installers.
