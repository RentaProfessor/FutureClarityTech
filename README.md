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
- `functions/api/prospects.js`: the Lead Finder's website checker. See "Lead
  Finder" below.

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
  call (the Supabase project, and OpenStreetMap for the Lead Finder). Extensionless clean URLs do not
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

## Lead Finder: find businesses to call

**`/dashboard/leads.html`** (button **Find leads** on the Client Pipeline) opens
with the same dashboard code. Pick a kind of business, a neighborhood and a
distance (1, 3, 5 or 10 miles), and it:

1. Searches **OpenStreetMap** for matching businesses, straight from the page.
   It's free, needs no key or account, and the Valley neighborhoods are built in.
   Any other place typed in is looked up once (OpenStreetMap's Nominatim) and
   remembered on that device.
2. Opens each business's website once and checks what a cold call needs: a
   Facebook or booking-app page instead of a site, a broken or parked site, no
   online booking, not built for phones, "Not secure", an old copyright year,
   which booking or shop software they already use, and any email address.
3. Scores each one 0–100 (**Hot** 60+, **Warm** 45+) and sorts the best first.
   Chains (businesses OpenStreetMap tags with a brand), dealerships and vet clinics
   are hidden by default.
4. For each business, gives a phone opener, voicemail and email built from what
   it found, plus answers to the usual objections.
5. **Save** puts it on the **Call list**. Tap what happened after each call
   (no answer, left message, interested…) and it sets the status and the next
   follow-up date. Download it as CSV anytime.
6. **Book audit → Client Pipeline** creates the request (source *Cold call*) with
   what we found already in the proposal's "What we found" and a suggested
   starting scope.

**What OpenStreetMap doesn't have.** It has no ratings or review counts, and it
misses some shops and some websites and phone numbers. That's why the page says
"No website found" (never "no website") and never guesses at reviews. Each business has
**Look up on Google Maps** (an ordinary link, no key) and boxes for the Google
rating, reviews, website and phone. Type what you see there and the score and
scripts update. A typed-in website gets checked like any other. Shops that aren't
on the map at all go in with **+ Add a business**.

### Setup

Run `supabase/prospects.sql` in Supabase > SQL Editor, after `schema.sql` and
`dashboard_code.sql`. It's safe to re-run. Like `requests`, the table can only be reached
through `prospects_*` functions that require the dashboard code. There's nothing
else to set up: no keys, accounts or Cloudflare settings.

The website check is `functions/api/prospects.js`, a Cloudflare Pages Function
like `functions/_middleware.js`, deployed with the site. It exists only because
browsers won't let a page read another website. It needs no settings, and it only
answers when the dashboard code checks out, so it can't be used as a free web
fetcher. If it isn't deployed, searching still works and each site shows
"Couldn't check the website".

`public/_headers` allows the page to call OpenStreetMap: two Overpass servers and
Nominatim. Private.coffee's server goes first because the main one (overpass-api.de)
is often rate-limited. If the first hasn't answered in 8 seconds, the page asks the
other too and uses whichever answers first. After 30 seconds it stops and says the
servers are busy, instead of spinning.

### What it costs

Nothing. OpenStreetMap is free; please keep searches to what you need, as its
servers are run by volunteers. The website checks run on Cloudflare's free plan,
3 sites per call, sized for its 50-subrequest and 10 ms CPU limits. Listings are
© OpenStreetMap contributors, credited under the results.

### Why these business types

The order on the page is the recommendation, from research in October 2026:

- **Auto repair (best fit):** up to 21% of calls to auto service businesses go
  unanswered (Marchex), and the average repair order is about $479 (Tekmetric
  TM-500). The owner is usually at the counter. Nearly all shops already run shop
  software, so sell what sits alongside it (missed-call text-back, review requests,
  service-due and smog-due nudges, an owner dashboard), not a replacement. Shops
  already pay $294–$699 a month for marketing add-ons like Steer and Kukui.
- **Pet groomers:** can't answer with a dog on the table. Regulars return every
  4–8 weeks, no-shows run 5–15%, and few agencies call on them. Smaller tickets
  (about $98 for a full groom in LA).
- **Auto detailing & tint:** solo crews, slow quotes for coating, PPF and tint,
  light software use, and they sit on the same streets as the repair shops.
- **Lower priority:** barbershops and salons (Booksy, Squire and Vagaro already
  send reminders, and many barbers rent their own chair). Med spas, dentists and
  HVAC have the money but are crowded with agencies and $250–500/month software,
  and the medical ones add HIPAA.

To change the list, the scripts or the typical ticket used in the ROI line, edit
`VERTICALS` at the top of the script in `public/dashboard/leads.html`. `osm` is
each type's OpenStreetMap search (map tags such as `shop=car_repair`, in Overpass
syntax), and `workflows` must use the Client Pipeline's workflow names.

### Outreach rules (practical, not legal advice)

- **Calls and visits:** fine to businesses. Call by hand, 8am–9pm. No
  autodialers, prerecorded messages or AI voices. Keep your own do-not-call
  list: mark anyone who asks **Not interested** and don't call again.
- **Don't cold-text.** Text only after someone asks you to ("text me the demo").
  The TCPA and California Business & Professions Code §17538.41 both restrict
  unsolicited texts.
- **Email (CAN-SPAM):** honest subject, a real postal address, and a working
  opt-out honored within 10 business days. The emails include the opt-out line.
  Add your mailing address under **Your details** on the Lead Finder.
- **California:** announce it if you record a call (all-party consent).

