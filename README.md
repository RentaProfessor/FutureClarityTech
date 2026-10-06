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
- `public/data/places/` and `scripts/build-places.py`: the Lead Finder's business
  list and the script that builds it from Overture Maps data.
- `public/dashboard/audit.js`: makes the Lead Finder's downloadable audit PDFs, in
  the browser.

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

## Lead Finder: find businesses to call

**`/dashboard/leads.html`** (button **Find leads** on the Client Pipeline) opens
with the same dashboard code. Pick a kind of business, a neighborhood and a
distance (1, 3, 5 or 10 miles), and it:

1. Searches a **business list built into the site** (`public/data/places/`, from
   Overture Maps open data, below). It's instant and needs no outside server, key
   or account. Any Valley neighborhood, city or ZIP code works, with suggestions
   as you type.
2. Opens each business's website once and checks what a cold call needs (see
   "The website check" below): whether it's a real website at all, phones,
   booking, "Not secure", an old copyright year, the basics Google looks for,
   which software they already use, and any email address.
3. Scores each one 0–100 (**Hot** 60+, **Warm** 45+) and sorts the best first.
   Chains (listings with a brand, or a known chain name), dealerships and vet
   clinics are hidden by default. Results show 150 at a time.
4. For each business, gives a phone opener, voicemail and email built from what
   it found, plus answers to the usual objections.
5. **Save** puts it on the **Call list**. Tap what happened after each call
   (no answer, left message, interested…) and it sets the status and the next
   follow-up date. Download it as CSV anytime.
6. **Download audit (PDF)** on a saved business makes a short audit for the
   owner, to attach to the email or print for a visit (below).
7. **Book audit → Client Pipeline** creates the request (source *Cold call*) with
   what we found already in the proposal's "What we found" and a suggested
   starting scope.

**What the list doesn't have.** It has no ratings or review counts, and it can
miss a website or a newer shop. That's why the page says "No website found"
(never "no website") and never guesses at reviews. Each business has **Look up
on Google Maps** (an ordinary link, no key) and boxes for the Google rating,
reviews, website and phone. Type what you see there and the score and scripts
update. A typed-in website gets checked like any other. Shops that aren't listed
go in with **+ Add a business**.

### The website check

Many website links in the business list are stale, so the check first decides
whether the address is a real website at all:

- **For sale or parked.** A redirect to a domain marketplace or registrar
  (GoDaddy, Afternic, Sedo, HugeDomains, Namecheap and others) or parking code on
  the page (GoDaddy's parking page, ad-parking scripts). "For sale" is only said
  when the page or marketplace says so; otherwise it's a parking page, which can
  also be a domain the owner never connected.
- **Expired or not registered.** When a site is down or parked, the check asks
  the domain's registry (RDAP, public and free): not registered at all, expired
  or on hold, or pointed at a parking service.
- **Placeholder.** "Coming soon", a web host's default page, "account
  suspended", "website expired", a builder's "not connected" page, a redirect to
  the host's homepage, or a blank page.
- **Someone else's site.** A real page that never mentions the business's name
  or its trade (a law firm on an auto shop's listing). A rebranded shop still
  mentions its trade, so it isn't flagged.
- A Facebook, booking-app or directory page (Yelp, Hub.biz, Yellow Pages...)
  instead of a site, a free builder address (name.wixsite.com), and a broken site.

For a real site it also checks the basics Google looks for: a page title that
isn't just "Home", a description, a "noindex" that hides the site, business
details for Google (structured data), and whether the page mentions the business's
area and shows the phone on its listing. "Not on the page" only counts when the
whole page was read. It also notes other software (analytics, chat, payments,
email, review widgets, app store links, forms) for the audit's suggestions.

The Lead Finder sends each business's name, area and phone along with its
website for those checks. The checks run within the free plan's limits: about 2
ms of CPU per page, under 7 ms for a full call.

### The downloadable audit

Saved businesses get **Download audit (PDF)**: branded, written for the owner,
usually two pages: what we found, then what we'd do. It has:

- How many checks passed, and the three biggest openings.
- The checks in three groups (your website, getting found on Google, turning
  visitors into customers). Problems get a plain-English reason; what's fine is
  a short list of ticks.
- Three things we'd set up for that kind of business: a website first when the
  site is the problem, then getting found on Google, then the automations.
- "More we could build for you": other things that fit what the site is missing,
  such as invoices and payment reminders, a quote form, a text-us button,
  visitor tracking or an app tune-up.
- What one missed call is worth (the same estimate as the Lead Finder's).
- The next step (a free in-person audit) and your sign-off from **Your details**.

The website is checked again right before the PDF is made, so it never repeats
something they've since fixed. Rows only state what we saw. Reviews appear once
you've typed them in from Google, and a missing phone is left out rather than
called missing. The card warns when there's no website on file, since the audit
would then say we couldn't find one.

On the **Call list**, **Download audits (PDF)** puts an audit for each business
shown (the picked box and search, up to 50) into one PDF with a bookmark for each,
for printing before a day of visits. Websites not checked in the last week are
checked first.

`public/dashboard/audit.js` writes the PDF itself, with no library and no server.
It uses Helvetica, which every PDF viewer has built in, so a page is a few KB.
Letters outside Western European ones are simplified or left out of names. The
document title keeps the full name.

### The business list

`scripts/build-places.py` builds it from the [Overture Maps](https://docs.overturemaps.org/)
places data: free, updated monthly, and drawn from Meta, Microsoft, Foursquare and
others under CDLA-Permissive-2.0 (credited under the results). It covers the San
Fernando Valley and nearby, from Calabasas to Glendale and from the Hollywood Hills
to Sylmar, plus west Pasadena. There's one file per kind of business:

- About 2,500 auto repair and smog shops, 718 body shops, 489 detailing and tint
  shops, 226 groomers, 265 tattoo studios, 3,567 barbers and salons, and 1,177
  martial arts schools and gyms.
- About 11,000 other appointment businesses for "Something else".

98% of the auto shops have a phone number, 73% a website and 35% an email. Closed
places and low-confidence listings are left out.

To refresh it from Overture's latest release (or change the area in the script):

```sh
pip install pyarrow fsspec aiohttp
python scripts/build-places.py
```

Then commit `public/data/places/`.

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

### What it costs

Nothing. The business list is a set of files on the site. The website checks run
on Cloudflare's free plan, 3 sites per call, sized for its 50-subrequest and 10 ms
CPU limits.

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
`VERTICALS` at the top of the script in `public/dashboard/leads.html`, and
`workflows` must use the Client Pipeline's workflow names. Which Overture
categories go into each kind of business is set in `GROUPS` in
`scripts/build-places.py`.

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

