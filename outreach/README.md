# Outreach Sequencer

A self-hosted replacement for the parts of Instantly/Smartlead/Lemlist that a
2-person studio actually needs: campaign sequencing with stop-on-reply, daily
caps, a send window, reply/bounce detection, opt-out suppression, and a
pipeline view — running free on Cloudflare Workers (cron) + D1, sending
through the Gmail API.

Deliberately **not** included, with reasons:

- **No tracking pixels.** They add ~15% spam-folder likelihood (Lemlist's own
  data) and opens are fiction post-Apple-MPP. Optimize replies, which this
  does track.
- **No warm-up network.** Peer warm-up pools sit against Gmail's ToS and
  Google has been burning them. Warm up manually: real emails to real people
  for 3–4 weeks, with `SEND_CAP_PER_DAY = 10`.
- **No scraping, no purchased lists.** Prospects are added by hand with a
  required `observation` field — the personalization that ~doubles replies
  (Woodpecker, 20M+ emails). The API rejects prospects without one.
- **No automated re-enrollment.** A finished sequence ends. Re-approaching a
  business is a human decision.

## Non-negotiable compliance rules (enforced or required)

- Every email gets a footer with a **real postal address** and a plain-language
  opt-out (CAN-SPAM requires both). Set `POSTAL_ADDRESS` in `wrangler.toml`
  to a real address — a PO Box or registered-agent address is fine.
- Replies containing opt-out language auto-suppress the address permanently;
  honor any other opt-out within 2 days via `POST /suppress`.
- Send **only from the outreach domain** (e.g. `futureclaritytech.co`), never
  from `futureclaritytechnologies.com`. Set up SPF, DKIM, and DMARC on it
  before the first send (Google Workspace admin → these are guided setups).
- Watch Google Postmaster Tools (postmaster.google.com) for the outreach
  domain; spam rate must stay under 0.3%, ideally under 0.1%.
- Defaults cap sends at 30/day, 5 per tick, weekdays 8am–noon Pacific.
  Start at 10/day for the first 3–4 weeks. Never exceed ~50/day per inbox.

## Setup (~45 minutes, one time)

1. **Outreach domain + inbox.** Buy the lookalike domain (~$10/yr), attach
   Google Workspace (~$7/mo), create the sending account, complete SPF/DKIM/
   DMARC setup in the Workspace admin console.
2. **Gmail API credentials.** Google Cloud console → new project → enable
   Gmail API → OAuth consent screen (External, add the outreach address as a
   test user) → Credentials → OAuth client ID → Desktop app. Then:
   ```sh
   node scripts/get-refresh-token.mjs <client_id> <client_secret>
   # sign in AS THE OUTREACH ACCOUNT; copy the printed refresh token
   ```
3. **Deploy.**
   ```sh
   npm install
   npx wrangler login
   npm run db:create            # copy the printed database_id into wrangler.toml
   npm run db:migrate
   npx wrangler secret put GMAIL_CLIENT_ID
   npx wrangler secret put GMAIL_CLIENT_SECRET
   npx wrangler secret put GMAIL_REFRESH_TOKEN
   npx wrangler secret put API_TOKEN     # any long random string; used as Bearer auth
   # edit wrangler.toml: FROM_EMAIL, POSTAL_ADDRESS, database_id
   npm run deploy
   ```

## Daily use

Add a batch (sequence is `restaurant` or `retail`; `observation` is required
and should be the specific problem you saw):

```sh
curl -X POST https://<worker-url>/prospects \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '[{
    "email": "owner@place.com",
    "first_name": "Maria",
    "business": "La Cocina",
    "observation": "your menu is a scanned PDF that'\''s unreadable on a phone.",
    "demo_url": "https://demo-grill.pages.dev",
    "sequence": "restaurant"
  }]'
```

Check the pipeline (includes reply rate vs the 3–8% benchmark, and which
prospects are due a phone call — the engine suggests calling after two
silent emails, because calls drove 33.6% of appointments in Belkins' data
and even voicemail ~doubles email replies per Gong):

```sh
curl -H "Authorization: Bearer $API_TOKEN" https://<worker-url>/pipeline
```

Other endpoints: `POST /prospects/:id/called` (log a call),
`POST /prospects/:id/stop`, `POST /suppress {"email": "..."}`.

The cron does the rest: every 30 minutes it checks threads for replies and
bounces, then sends whatever the caps and window allow. Replies land in the
outreach inbox like any other email — **answer them within minutes if you
can** (responding in 5 minutes vs 30 makes you 21x more likely to qualify
the lead — MIT/InsideSales).

## Development

```sh
npm test          # pure-logic engine tests, no network
```

`src/engine.js` holds all sequencing rules as pure functions;
`src/index.js` is the Worker glue; `src/templates.js` is where the email
copy lives. Edit copy freely — the test suite enforces the 50–120-word
evidence band.
