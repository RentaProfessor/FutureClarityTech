# Portfolio kit

Everything needed to stand up a personal GitHub portfolio: six project repositories, cleaned
up and ready to publish, a profile README, and a script that publishes all of it in one go.
Each folder here becomes its own repository with a single clean first commit.

| Folder | Repository | Pin order |
|---|---|---|
| `redline-shopify-store/` | Shopify store: SKU standard, tag-driven collections, catalog audit tool | 1 |
| `local-business-lead-finder/` | Website checker and PDF audits for local-business leads (Cloudflare + Postgres) | 2 |
| `legacy-tape-firmware/` | ESP32-S3 firmware for the Legacy Tape recorder | 3 |
| `plantwatch/` | Sensor-driven watering advice: Supabase edge functions, PWA, SwiftUI | 4 |
| `webrtc-poker/` | Peer-to-peer Texas Hold'em over WebRTC with a tested engine | 5 |
| `assigndash/` | Syllabus → assignment dashboard with OpenAI structured outputs | 6 |
| `profile/` | Your profile README (`<username>/<username>`) | — |

## Publish

1. Install the [GitHub CLI](https://cli.github.com) and log in as your **personal** account:
   `gh auth login`.
2. Make sure your commits will count on that account's contribution graph:
   `git config --global user.email "<an email verified on that account>"`.
3. Get this kit and run the script:

   ```sh
   git clone --branch claude/laughing-knuth-k9b8m8 --single-branch \
     https://github.com/RentaProfessor/FutureClarityTech.git portfolio-kit
   cd portfolio-kit/portfolio
   ./publish.sh --dry-run     # shows exactly what it will create
   ./publish.sh               # creates the repos and pushes them
   ```

   It only creates repositories; anything that already exists on your account is skipped.
4. On your profile, choose **Customize your pins** and pin the six repositories in the order above.
5. Fill in the few things only you can add (each is marked with an HTML comment in the README
   that needs it): the school/role line and contact links in your profile README, and photos or
   a short video of the Legacy Tape device.

## Project notes

What was cleaned up or finished in each repository, and what an interviewer is likely to ask
about. You should be able to walk through every one of these answers in your own words.

### redline-shopify-store (Redline Motor Club)

- **Added:** the written merchandising standard (`docs/`), the standard as data
  (`standards/standards.json`), a catalog exporter and auditor in plain Python with 26 tests, and
  CI. The theme folder holds only your three configuration files; Horizon itself can't be
  redistributed under its license, and the README says so.
- **Fixed in the live store:** the Drop 00 markdown had ended on September 30 while four products
  still showed sale prices (now runs to December 31, and the Sale collection follows the new tag),
  and the wallet's featured image was a group flat lay (now a wallet photo). A theme copy named
  **"Redline Motor Club (cart drawer)"** restores the slide-out cart and hides the trailing "USD"
  on prices; **publish it in Shopify admin → Online Store → Themes** (the connector can't publish
  themes).
- **Be ready to explain:** why colorways are variants, not products; how the SKU pattern encodes
  category/style/color/size; why a markdown is a tag with an end date; why "Shop All" points at
  the in-stock collection; why Truckers excludes kids' hats by title (tag rules can't say "is not");
  what the audit checks and why it exits non-zero.

### plantwatch

- **Scrubbed:** every name, address, coordinate, email and password; the Supabase URL and key moved
  to config files that aren't committed. Published with fresh history, so the old commits never
  appear.
- **Fixed and finished:** one typed advice engine (it now uses the rain forecast and consistent
  thresholds), clear errors when Ecowitt rejects keys, an additive migration that closes two RLS
  holes (users could grant themselves admin, or attach plants to someone else's gateway) and makes
  onboarding one atomic RPC, zones loaded from the database, and a demo mode. 68 Deno tests
  (including database tests on PGlite), 14 Playwright tests, CI.
- **If you redeploy your live project from this version:** apply the new migration before
  deploying the new web client, delete the old `plant-report` function, and run
  `supabase migration repair --status reverted 20260525000001`. The iOS bundle id changed to
  `com.plantwatch.app`, which would need a new App Store Connect record.
- **Be ready to explain:** forwarding the user's JWT so row-level security does the tenant
  isolation; why onboarding is a SECURITY DEFINER function with an empty `search_path`; the rain
  deferral rules; how the browser and server share one advice engine.

### webrtc-poker (Poker Room)

- **Fixed:** the betting round ended after the first check after the flop (the turn was dealt
  before anyone else could act); an invalid action cancelled the turn timer and froze the hand;
  someone sitting down mid-hand could take over the turn; side-pot winnings were reported
  wrong; a busted dealer sent the button to the lowest seat; chip amounts from peers were never
  validated (a string amount corrupted the pot).
- **Added:** uncalled-bet returns, odd-chip rules, auto-check on timeout, a uniform shuffle, a pot
  breakdown and the board in the results overlay, 44 tests including a 600-hand fuzz test, CI, and
  a README with screenshots. Toolchain upgraded (Vite 8, TypeScript 7), `npm audit` clean.
- **Live demo:** after publishing, run `npm run deploy` from the new repo and add the
  `*.pages.dev` link to the README and the repo's website field.
- **Be ready to explain:** the host-authoritative model and its trust limits (the host can see
  every card), how side pots are layered, why actions are validated twice (at the network boundary
  and in the engine), and what the fuzz test proves.

<!-- MORE PROJECT NOTES -->
