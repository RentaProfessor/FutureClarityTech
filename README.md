# FutureClarity Technologies

Marketing site for FutureClarity Technologies, a small web studio that builds
websites and apps for small businesses.

Built with [Astro](https://astro.build) 5 and [Tailwind CSS](https://tailwindcss.com) 4,
deployed on Cloudflare Pages.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # production build, output in dist/
npm run preview  # preview the production build
```

## Where things live

- `src/pages/`: the two routes, `index.astro` (home) and `portfolio.astro` (work)
- `src/components/`: shared header and footer, plus the hand-drawn illustrations
  (`Workbench.astro` in the hero, `Cassette.astro` in the LegacyTape section)
- `src/layouts/Layout.astro`: HTML shell, meta tags, font loading
- `src/styles/global.css`: Tailwind import, design tokens (`@theme`), and the
  handful of shared component classes (`.btn`, `.link`, `.field`, `.eyebrow`)
- `public/`: favicon, project screenshots/videos, Cloudflare `_headers` and `_redirects`

## Notes

- Type: Fraunces for headlines, Public Sans for text, IBM Plex Mono for labels
  (all loaded from Google Fonts in `Layout.astro`).
- The contact form posts to Formspree.
- The portfolio page shows each project as a scaled-down live iframe on desktop.
  On phones, where the iframes misbehave, it swaps in looping screen recordings
  (the `.mp4` files in `public/`).
- Anchor links in the header/footer are rewritten to `/?scroll=<id>` on pages
  other than the homepage, and the homepage scrolls to the section on load.
