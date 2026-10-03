# FutureClarity Technologies

Marketing site for FutureClarity Technologies. We build local, appointment-based
businesses a custom dashboard and the automations behind it, and we also build
websites and clean up existing apps.

Built with [Astro](https://astro.build) 5, deployed on Cloudflare Pages.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # production build, output in dist/
npm run preview  # preview the production build
```

## Where things live

- `src/pages/index.astro`: the whole site — one page, anchored sections
  (`#how`, `#custom`, `#web`, `#pricing`, `#process`, `#working`, `#contact`)
- `src/pages/404.astro`: real 404 page, so unmatched paths return HTTP 404
  instead of a soft 404
- `src/components/`: `Header`, `Footer`, `LogoMark`, and `SvgDefs` (the shared
  gradients and glow filter the lens mark depends on)
- `src/layouts/Layout.astro`: HTML shell, meta tags, font loading, JSON-LD
- `src/styles/global.css`: design tokens and every component class
- `public/`: favicons, Cloudflare `_headers` and `_redirects`, `robots.txt`
- `functions/_middleware.js`: 301s any `*.pages.dev` hostname to the custom
  domain

## SEO notes

These are load-bearing. Read the comments before changing any of them.

- `astro.config.mjs` `site:` **must** stay the custom domain. It drives
  `<link rel="canonical">`, `og:url`, `og:image` and the generated sitemap.
  Pointing it at the pages.dev hostname is what previously told Google the
  pages.dev copy was canonical.
- `functions/_middleware.js` matches **any** `*.pages.dev` host, which includes
  Cloudflare deploy previews — so previews redirect to production and cannot be
  viewed. To QA a preview, narrow the test to an exact match as described in
  that file's comments.
- `public/_redirects` holds the 301 from the retired `/portfolio`. Never add a
  `/*  /index.html  200` catch-all; that produces soft 404s.
- `public/_headers` sets the CSP. The lead form submits with `fetch()`, which is
  governed by `connect-src` — not `form-action`. Extensionless clean URLs do not
  match the `/*.html` cache rule, so any new route needs its own entry.
- `Layout.astro` emits `Organization` and `WebSite` JSON-LD. Keep the name,
  phone and email byte-identical to the Google Business Profile listing. Add a
  postal address and `areaServed` and it can become a `LocalBusiness`.

## Lead form

The contact form posts to Formspree (`formspree.io/f/movkledr`). It is a real
`<form action method="POST">`, so it still works with JavaScript disabled; the
script upgrades it to a `fetch()` and keeps the visitor on the page.

To move it to Supabase, set these at build time:

```sh
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<anon key>
PUBLIC_SUPABASE_LEADS_TABLE=leads   # optional, defaults to "leads"
```

When both of the first two are present the form posts to Supabase and falls
back to Formspree if that request fails. Before switching it on:

1. Give the leads table row level security with an **INSERT-only** policy for
   the `anon` role. The anon key ships in the page, so without that policy
   anyone can read every lead back out.
2. Add the Supabase host to `connect-src` in `public/_headers`, or the browser
   blocks the request with no visible error.
3. Add some spam protection. A public insert endpoint will be found by bots.
