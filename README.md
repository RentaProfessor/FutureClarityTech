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
- `public/_headers` sets the CSP. `connect-src` lists the only hosts the pages may
  call (the Supabase project). Extensionless clean URLs do not
  match the `/*.html` cache rule, so any new route needs its own entry.
- `Layout.astro` emits `Organization` and `WebSite` JSON-LD. Keep the name,
  phone and email byte-identical to the Google Business Profile listing. Add a
  postal address and `areaServed` and it can become a `LocalBusiness`.

## Audit booking: website → Supabase → dashboard

1. **Homepage form** (`src/pages/index.astro`) collects name, business and
   contact, then hands them to step 2. Nothing is sent from this page.
2. **`/plan.html`** (`public/plan.html`): the visitor picks automations,
   website and app work, sees a typical price range, and taps **Send**. That
   inserts one row into Supabase `requests` through `public/fc-store.js`. If
   the insert fails, the page offers email / text / copy buttons instead.
3. **`/dashboard/`** (`public/dashboard/index.html`): the team's Client
   Pipeline. Opens with the **dashboard code**; new requests show up within
   10 seconds.

**Dashboard code.** Typing the code as the whole message on the homepage form
(one word, capitals ignored) opens `/dashboard/`; it can also be typed on the
dashboard itself. The code is checked by Supabase, not the browser: neither the
code nor a hash of it is in the site or this repo. The device remembers it until
"Sign out". Set or change it in Supabase > SQL Editor:

```sql
insert into public.dashboard_settings (id, code_hash) values (1, extensions.crypt(lower('YOURCODE'), extensions.gen_salt('bf'))) on conflict (id) do update set code_hash = excluded.code_hash;
```

Note: someone who fills in step 1 but leaves before tapping Send on step 2 is
not recorded anywhere.

### Supabase

Project `bzudkcybqhmqrybskwfn`. URL and publishable key are in
`public/fc-config.js` (public by design; access is enforced by row level
security). If both are ever emptied, the pages fall back to demo mode, where
requests stay in the visitor's own browser.

- **Schema:** run `supabase/schema.sql`, then `supabase/dashboard_code.sql`, in
  Supabase > SQL Editor. Both are safe to re-run. `schema.sql` creates
  `requests` and `team_members` and adds `requests` to realtime. First team member: beng@futureclaritytechnologies.com. To add one:
  `insert into public.team_members (email) values (lower('their@email.com')) on conflict do nothing;`
  and invite them under Authentication > Users.
- **Who can do what:** the public key may only INSERT a request, and only the
  customer columns; it can never read a row back. Reading, editing, adding and
  deleting go through `dashboard_*` functions that require the code; a wrong
  code waits 1 second before failing, to slow guessing. (The email sign-in and
  `team_members` setup from `schema.sql` is still in the database but unused by
  the site for now; restoring it means bringing back supabase-js and the email
  login from git history.)
- **CSP:** `connect-src` allows only this Supabase project, over https. No
  third-party scripts.

`/plan` and `/dashboard/` are sent with `X-Robots-Tag: noindex` from
`public/_headers`, and as static files in `public/` they are not in the
sitemap.
