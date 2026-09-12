// Pure audit logic — no I/O, no runtime-specific APIs.
//
// Shared by the local research CLI (tools/audit/cli.mjs) and, if we ever
// publish the public tool, by a Cloudflare Function. Keeping it pure means the
// findings a prospect would see and the findings we act on can never drift.

// Server response time is measured from wherever the check runs, NOT from a
// phone on a cell network. Real mobile load time is strictly worse. Thresholds
// sit where the number alone is already damning, so the claim stays true.
export const SLOW_TTFB_MS = 1500;
export const VERY_SLOW_TTFB_MS = 3000;

export const SOCIAL_HOSTS = [
  ['Instagram', 'instagram.com'],
  ['Facebook', 'facebook.com'],
  ['Yelp', 'yelp.com'],
  ['TikTok', 'tiktok.com'],
];

export function buildChecks({ f, finalUrl, ttfbMs, originalUrl }) {
  const checks = [];
  const add = (id, label, pass, detail, why, weight = 'normal') =>
    checks.push({ id, label, pass, detail, why, weight });

  add(
    'https',
    'Secure (HTTPS)',
    finalUrl.protocol === 'https:',
    finalUrl.protocol === 'https:'
      ? 'Served over HTTPS.'
      : 'Served over plain HTTP.',
    "Chrome shows a “Not secure” warning on HTTP sites. Customers read that as “this business isn't real.”",
    'critical',
  );

  add(
    'mobile',
    'Works on phones',
    f.hasViewport,
    f.hasViewport
      ? 'Has a mobile viewport tag.'
      : 'No mobile viewport tag — the page renders zoomed-out on a phone.',
    'Most local searches happen on a phone. Without this the page loads desktop-width and everything is tiny.',
    'critical',
  );

  const fast = ttfbMs < SLOW_TTFB_MS;
  add(
    'speed',
    'Server response time',
    fast,
    `${(ttfbMs / 1000).toFixed(1)}s to first response.`,
    'Measured from a data centre, so a real phone on cell data is slower still. Past ~3s most visitors leave before seeing anything.',
    ttfbMs > VERY_SLOW_TTFB_MS ? 'critical' : 'normal',
  );

  add(
    'phone',
    'Tappable phone number',
    f.telLinks > 0,
    f.telLinks > 0
      ? `${f.telLinks} tap-to-call link${f.telLinks === 1 ? '' : 's'}.`
      : 'No tap-to-call link anywhere on the page.',
    'A phone number that is plain text cannot be tapped. On mobile this is the single most common way a local business loses a ready-to-buy customer.',
    'critical',
  );

  add(
    'contact',
    'Way to get in touch',
    f.formCount > 0 || f.mailtoLinks > 0 || f.telLinks > 0,
    f.formCount > 0
      ? `${f.formCount} form on the page.`
      : f.mailtoLinks > 0
        ? 'Email link present.'
        : 'No form, email link, or phone link found.',
    'If there is no obvious way to make contact, interested visitors leave and go to a competitor.',
    'critical',
  );

  add(
    'title',
    'Page title',
    f.title.length >= 10 && f.title.length <= 65,
    f.title
      ? `“${f.title.slice(0, 80)}” (${f.title.length} characters)`
      : 'No page title.',
    'The title is the blue clickable line in Google results. Too short says nothing; past ~65 characters Google cuts it off.',
  );

  add(
    'description',
    'Search description',
    f.metaDescription.length >= 50 && f.metaDescription.length <= 160,
    f.metaDescription
      ? `${f.metaDescription.length} characters.`
      : 'No meta description — Google will invent one from page text.',
    'This is the grey summary under your link in search results. It is the pitch that decides whether anyone clicks.',
  );

  add(
    'h1',
    'One clear headline',
    f.h1Count === 1,
    f.h1Count === 0 ? 'No H1 heading.' : `${f.h1Count} H1 headings.`,
    'Search engines use the H1 to understand what the page is about. Zero leaves it ambiguous; several compete with each other.',
  );

  add(
    'localseo',
    'Local business listing data',
    f.localBusinessSchema,
    f.localBusinessSchema
      ? 'Structured business data found.'
      : 'No structured business data (name, address, hours) in the page code.',
    'This is the machine-readable block Google reads to show your hours, address and rating directly in search results. Without it you are a plain blue link next to competitors with a full listing.',
    'critical',
  );

  add(
    'social-preview',
    'Link previews',
    f.ogTitle && f.ogImage,
    f.ogTitle && f.ogImage
      ? 'Preview title and image set.'
      : 'No preview image or title set.',
    'Controls what appears when someone shares your link in a text message or on Instagram. Without it the link posts as a bare grey URL that nobody taps.',
  );

  add(
    'alt-text',
    'Image descriptions',
    f.imgTotal === 0 || f.imgNoAlt / f.imgTotal <= 0.3,
    f.imgTotal === 0
      ? 'No images on the page.'
      : `${f.imgNoAlt} of ${f.imgTotal} images have no description.`,
    'Image descriptions are what screen readers announce, and they are also how Google Images finds your photos.',
  );

  add(
    'favicon',
    'Browser tab icon',
    f.hasFavicon,
    f.hasFavicon ? 'Favicon set.' : 'No favicon — browsers show a blank page icon.',
    'Small, but it is what your site looks like in a bookmark bar or a tab full of competitors.',
  );

  return checks;
}

// Headline selection.
//
// Two constraints pull against each other. Commercial weight says always lead
// with the missing tap-to-call link, because that is the one that visibly costs
// a restaurant customers. Personalisation says never send five prospects the
// same sentence — a line that could be about anyone reads as a mail merge, and
// the whole reason to hand-research a list is that specificity roughly doubles
// reply rates.
//
// So: `common` carries how many sites in the current batch share each failure.
// A finding that everyone fails is worth less as an opener than one that is
// distinctive AND concrete, even if the universal one is technically graver.
// Findings that quote a number from the site ("23 of 23 photos") beat binary
// ones, because a number proves someone actually looked.
//
// Pass `common` as {} for a single-site audit and it falls back to pure
// commercial priority.

const PRIORITY = [
  'mobile', 'https', 'speed', 'phone', 'contact', 'localseo',
  'social-preview', 'title', 'description', 'h1', 'alt-text',
];

export function pickHeadline(failed, ttfbMs, f, common = {}, batchSize = 1) {
  const failedIds = new Set(failed.map((c) => c.id));
  const has = (id) => failedIds.has(id);

  const text = {
    mobile: 'their site loads desktop-width on a phone, so the text comes up too small to read',
    https: "their site still runs on plain HTTP, so Chrome labels it \u201cNot secure\u201d",
    speed:
      ttfbMs > VERY_SLOW_TTFB_MS
        ? `their site takes over ${Math.floor(ttfbMs / 1000)} seconds to respond, measured from a data centre`
        : `their site takes ${(ttfbMs / 1000).toFixed(1)}s to respond before anything renders`,
    phone: 'there is no tap-to-call number anywhere on their site',
    contact: 'there is no form, email, or phone link on their site at all',
    localseo:
      'their site has no structured business data, so Google cannot show their hours or address in search results',
    'social-preview':
      'their link posts as a bare grey URL with no image when shared in a text or on Instagram',
    title: 'their page title is missing or truncated in Google results',
    // Three distinct states, and conflating them produces a false claim: a
    // description that is merely too long is not a missing one, and telling an
    // owner they have none when they wrote one is an instant credibility loss.
    description: !f.metaDescription
      ? 'they have no search description, so Google is inventing the text under their link'
      : f.metaDescription.length < 50
        ? `their search description is only ${f.metaDescription.length} characters, so Google is rewriting it`
        : `their search description runs ${f.metaDescription.length} characters, so Google cuts it off mid-sentence in results`,
    h1:
      f.h1Count > 1
        ? `their homepage has ${f.h1Count} competing main headings, so search engines cannot tell what the page is about`
        : 'their page has no single clear headline for search engines to read',
    'alt-text': `${f.imgNoAlt} of their ${f.imgTotal} photos have no description, so Google Images cannot find them`,
  };

  // Concrete = the sentence quotes a number measured off their site.
  const CONCRETE = new Set(['speed', 'h1', 'alt-text', 'description']);

  const scored = PRIORITY.filter(has).map((id) => {
    const rank = PRIORITY.indexOf(id);
    let score = 100 - rank * 6; // commercial weight
    if (CONCRETE.has(id)) score += 14; // a number proves someone looked
    // Fade anything the whole batch shares — it cannot read as personal.
    if (batchSize > 1) {
      const share = (common[id] || 0) / batchSize;
      if (share >= 0.8) score -= 34;
      else if (share >= 0.5) score -= 16;
    }
    return { id, score };
  });

  if (!scored.length) {
    return 'their site is in good shape \u2014 worth leading with something other than a technical problem';
  }
  scored.sort((a, b) => b.score - a.score);
  return text[scored[0].id];
}

// Every failing finding, in commercial order — so a human writing the email can
// see the alternatives rather than trusting the picker.
export function allObservations(failed, ttfbMs, f) {
  return PRIORITY.filter((id) => failed.some((c) => c.id === id)).map((id) => ({
    id,
    text: pickHeadline(failed.filter((c) => c.id === id), ttfbMs, f),
  }));
}
