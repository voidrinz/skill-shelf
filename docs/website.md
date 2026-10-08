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

## Search And Sharing

The build renders the React page into static HTML before publishing. Both the
English homepage and `/zh-CN/` include their full product content, FAQs, and
installer links without requiring JavaScript. React hydrates the page for its
interactive previews. Language links navigate between the two published pages.

Each page has a localized title and description, a canonical URL, reciprocal
`hreflang` links, Open Graph and X sharing metadata, and SoftwareApplication
structured data. `social-card.png` uses product branding and contains no user
data. The build also writes `sitemap.xml` and `robots.txt`.

`SITE_URL` supplies the public canonical address; the Pages workflow passes the
configured Pages URL, and local builds default to the live project website.
For a custom domain, update Pages settings so these URLs follow the new domain.

The live sitemap is <https://voidrinz.github.io/skill-shelf/sitemap.xml>. It can
be submitted to search-engine webmaster tools. Crawlers read `robots.txt` at
the domain root; the file under this project path cannot override another
site's root rules. Sitemap submission and public links help discovery, but
indexing is controlled by each search engine.
