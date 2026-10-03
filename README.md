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

## Lead form and audit booking

Booking a free audit is three steps:

1. **Homepage form** (`src/pages/index.astro`). Posts to Formspree
   (`formspree.io/f/movkledr`) first, so the lead always reaches us, then
   hands the details to step 2 and redirects there. It is a real
   `<form action method="POST">`, so it still works with JavaScript off.
2. **`/plan.html`** (`public/plan.html`). The visitor picks automations, website
   and app work, and sees a typical price range.
3. **Send.** `plan.html` submits through `public/fc-store.js` into the team
   dashboard at **`/dashboard/`** (`public/dashboard/index.html`).

### Demo mode until the backend is connected

`public/fc-config.js` holds the Supabase URL and anon key. While both are
empty, `plan.html` and `/dashboard/` run in **demo mode**: step-2 picks are
saved in the visitor's own browser only, and `plan.html` still shows "Request
sent". Step 1 has already reached Formspree, so no lead is lost, but the picks
do not reach anyone until the backend is connected.

To connect it:

- Run `supabase/schema.sql` in Supabase > SQL Editor (edit the two team emails at the
  bottom first). It creates `requests` and `team_members`, the row level security
  described below, and adds `requests` to realtime. Safe to re-run.

- Fill in `public/fc-config.js`. Never put the `service_role` key there.
- In `public/_headers`, add to the CSP: `https://cdn.jsdelivr.net` to
  `script-src` (the dashboard loads the Supabase library from there), and
  `https://<project>.supabase.co wss://<project>.supabase.co` to `connect-src`.
- Row level security on `requests`: the `anon` role may **INSERT only**, and
  only the customer columns (name, business, contact, website, app, needs,
  scope, est_shown). Team members (`team_members`) may select/update/delete.
  Anyone can call the insert endpoint directly, not just through the page.
- Make `id` a `uuid` or integer column, and cap `scope.wf` at 5 entries. The
  dashboard's request screen breaks on more than 5.
- Supabase Auth: Site URL `https://futureclaritytechnologies.com`, add
  `https://futureclaritytechnologies.com/dashboard/` to Redirect URLs, and
  turn off "Allow new users to sign up".

`/plan` and `/dashboard/` are sent with `X-Robots-Tag: noindex` from
`public/_headers`, so they stay out of search results. They are static files in
`public/`, so they are not in the sitemap either.

The `PUBLIC_SUPABASE_*` env-var path in `index.astro` predates `fc-store.js`
and is not needed for the setup above; leave those vars unset.
