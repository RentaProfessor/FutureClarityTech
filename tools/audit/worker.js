// Free website audit — the lead magnet and the outreach personalisation engine.
//
// Two jobs, one endpoint:
//   1. Public tool at /audit. A small-business owner pastes their URL and gets
//      an honest, specific report. That is a reason to visit the site that has
//      nothing to do with already wanting to hire us.
//   2. Outreach input. The sequencer refuses to queue a prospect without a
//      concrete `observation`, because personalisation is the measured lever
//      that doubles reply rates. Hand-researching that is what caps outreach at
//      25-40 prospects a week. `headline` below is generated to be pasted
//      straight into that field.
//
// Everything reported here is measured from the fetched HTML. Nothing is
// inferred, estimated, or padded — a report that overstates problems is worse
// than useless when the recipient owns the site and knows what is on it.

const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 3_000_000; // stop reading pathological pages

// Server response time is measured from Cloudflare's edge, NOT from a phone on
// a cell network. Real mobile load time is strictly worse. Thresholds are set
// where the edge number alone is already damning, so the claim stays true.
const SLOW_TTFB_MS = 1500;
const VERY_SLOW_TTFB_MS = 3000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Reject anything that is not a public website. A Worker cannot reach RFC1918
// space anyway, but validating here keeps the endpoint from being used as a
// probe against arbitrary hosts and ports.
function normaliseTarget(raw) {
  if (!raw || typeof raw !== 'string') return { error: 'Enter a website address.' };
  let input = raw.trim();
  if (!input) return { error: 'Enter a website address.' };
  if (input.length > 300) return { error: 'That address is too long.' };
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;

  let url;
  try {
    url = new URL(input);
  } catch {
    return { error: "That doesn't look like a website address." };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'Only http and https addresses can be checked.' };
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return { error: 'Only standard web ports can be checked.' };
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    !host.includes('.') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(':');
  if (blocked) return { error: 'Enter a public website address, like joesdiner.com.' };

  url.hash = '';
  return { url };
}

export async function onRequest(context) {
  const { request } = context;
  const reqUrl = new URL(request.url);

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Use GET or POST.' }, 405);
  }

  let raw = reqUrl.searchParams.get('url');
  if (request.method === 'POST' && !raw) {
    try {
      const body = await request.json();
      raw = body && body.url;
    } catch {
      /* fall through to the missing-url error */
    }
  }

  const { url, error } = normaliseTarget(raw);
  if (error) return json({ error }, 400);

  let res;
  let ttfbMs;
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    res = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Identify honestly. A site owner reading their logs should be able to
        // tell what hit them and why.
        'user-agent':
          'FutureClarityAudit/1.0 (+https://futureclaritytechnologies.com/audit)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    ttfbMs = Date.now() - started;
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    return json(
      {
        url: url.toString(),
        reachable: false,
        headline: timedOut
          ? `their website didn't respond within ${FETCH_TIMEOUT_MS / 1000} seconds`
          : "their website didn't load at all",
        error: timedOut
          ? "The site didn't respond in time. That usually means it's very slow or currently down."
          : "We couldn't reach that site. Check the address, or it may be down.",
      },
      200,
    );
  }

  const finalUrl = new URL(res.url || url.toString());
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    return json({
      url: url.toString(),
      finalUrl: finalUrl.toString(),
      reachable: true,
      status: res.status,
      headline: `their website returns an HTTP ${res.status} error`,
      error: `The site responded with HTTP ${res.status}.`,
    });
  }

  if (!contentType.includes('html')) {
    return json({
      url: url.toString(),
      finalUrl: finalUrl.toString(),
      reachable: true,
      status: res.status,
      headline: 'their address does not serve a normal web page',
      error: `That address returned ${contentType || 'an unknown type'}, not a web page.`,
    });
  }

  const f = await extract(res);

  const checks = buildChecks({ f, finalUrl, ttfbMs, originalUrl: url });
  const failed = checks.filter((c) => !c.pass);
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);

  return json({
    url: url.toString(),
    finalUrl: finalUrl.toString(),
    reachable: true,
    status: res.status,
    score,
    serverResponseMs: ttfbMs,
    htmlBytes: f.bytes,
    checks,
    // The single most specific, most concrete problem — written to drop
    // straight into a cold email's observation field, lower-case and
    // continuation-shaped ("I noticed <headline>").
    headline: pickHeadline(failed, ttfbMs, f),
  });
}

// Streaming HTML parse. HTMLRewriter is the right tool here: no DOM in Workers,
// and regex over someone else's markup produces confident wrong answers.
async function extract(res) {
  const f = {
    title: '',
    metaDescription: '',
    hasViewport: false,
    h1Count: 0,
    imgTotal: 0,
    imgNoAlt: 0,
    telLinks: 0,
    mailtoLinks: 0,
    formCount: 0,
    ogTitle: false,
    ogImage: false,
    jsonLd: [],
    hasFavicon: false,
    generator: '',
    bytes: 0,
    mapEmbed: false,
    socialLinks: new Set(),
  };

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(t) {
        if (f.title.length < 300) f.title += t.text;
      },
    })
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('name') || '').toLowerCase();
        const prop = (el.getAttribute('property') || '').toLowerCase();
        const content = el.getAttribute('content') || '';
        if (name === 'description') f.metaDescription = content;
        if (name === 'viewport') f.hasViewport = true;
        if (name === 'generator') f.generator = content;
        if (prop === 'og:title') f.ogTitle = true;
        if (prop === 'og:image') f.ogImage = true;
      },
    })
    .on('h1', {
      element() {
        f.h1Count += 1;
      },
    })
    .on('img', {
      element(el) {
        f.imgTotal += 1;
        const alt = el.getAttribute('alt');
        if (alt === null || alt.trim() === '') f.imgNoAlt += 1;
      },
    })
    .on('a', {
      element(el) {
        const href = (el.getAttribute('href') || '').trim().toLowerCase();
        if (href.startsWith('tel:')) f.telLinks += 1;
        else if (href.startsWith('mailto:')) f.mailtoLinks += 1;
        else {
          for (const [key, host] of SOCIAL_HOSTS) {
            if (href.includes(host)) f.socialLinks.add(key);
          }
        }
      },
    })
    .on('form', {
      element() {
        f.formCount += 1;
      },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (rel.includes('icon')) f.hasFavicon = true;
      },
    })
    .on('iframe', {
      element(el) {
        const src = (el.getAttribute('src') || '').toLowerCase();
        if (src.includes('google.com/maps') || src.includes('maps.google')) f.mapEmbed = true;
      },
    })
    .on('script[type="application/ld+json"]', {
      text(t) {
        if (f.jsonLd.length < 20) f.jsonLd.push(t.text);
      },
    });

  const transformed = rewriter.transform(res);
  const reader = transformed.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    f.bytes += value.byteLength;
    if (f.bytes > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
  }

  f.title = f.title.trim();
  f.socialLinks = [...f.socialLinks];
  // schema.org LocalBusiness has dozens of subtypes, and a dentist marks
  // up as "Dentist", not "LocalBusiness". Matching only the generic names
  // reported "no structured data" for sites that had perfectly good
  // markup -- a false accusation is the fastest way to lose a prospect on
  // the first line, so this covers the subtypes SMBs actually use. Also
  // handles "@type" given as an array.
  f.localBusinessSchema =
    /"@type"\s*:\s*(?:"[^"]*(?:LocalBusiness|Organization|Store|ProfessionalService|Restaurant|FoodEstablishment|CafeOrCoffeeShop|Cafe|BarOrPub|Brewery|Winery|Distillery|Bakery|FastFoodRestaurant|IceCreamShop|AutoRepair|AutoDealer|AutoBodyShop|AutoPartsStore|AutoWash|GasStation|MotorcycleRepair|Dentist|Physician|MedicalBusiness|MedicalClinic|VeterinaryCare|Optician|Pharmacy|HealthClub|HairSalon|BeautySalon|NailSalon|DaySpa|TattooParlor|HealthAndBeautyBusiness|Attorney|LegalService|AccountingService|InsuranceAgency|FinancialService|RealEstateAgent|HomeAndConstructionBusiness|Electrician|Plumber|HVACBusiness|Locksmith|RoofingContractor|GeneralContractor|HousePainter|MovingCompany|; ?CleaningService|DryCleaningOrLaundry|ChildCare|Preschool|School|EducationalOrganization|SportsActivityLocation|GymOrFitnessCenter|Florist|JewelryStore|ClothingStore|ShoeStore|BookStore|GroceryStore|SupermarketConvenienceStore|ConvenienceStore|HardwareStore|FurnitureStore|PetStore|LiquorStore|MobilePhoneStore|Hotel|Lodging|LodgingBusiness|BedAndBreakfast|TravelAgency|EntertainmentBusiness|MovieTheater|NightClub|EmploymentAgency|Notary|PhotographyBusiness|SelfStorage|ShoppingCenter|TouristAttraction)"|\[[^\]]*"[^"]*(?:LocalBusiness|Organization|Store|ProfessionalService|Restaurant|FoodEstablishment|CafeOrCoffeeShop|Cafe|BarOrPub|Brewery|Winery|Distillery|Bakery|FastFoodRestaurant|IceCreamShop|AutoRepair|AutoDealer|AutoBodyShop|AutoPartsStore|AutoWash|GasStation|MotorcycleRepair|Dentist|Physician|MedicalBusiness|MedicalClinic|VeterinaryCare|Optician|Pharmacy|HealthClub|HairSalon|BeautySalon|NailSalon|DaySpa|TattooParlor|HealthAndBeautyBusiness|Attorney|LegalService|AccountingService|InsuranceAgency|FinancialService|RealEstateAgent|HomeAndConstructionBusiness|Electrician|Plumber|HVACBusiness|Locksmith|RoofingContractor|GeneralContractor|HousePainter|MovingCompany|; ?CleaningService|DryCleaningOrLaundry|ChildCare|Preschool|School|EducationalOrganization|SportsActivityLocation|GymOrFitnessCenter|Florist|JewelryStore|ClothingStore|ShoeStore|BookStore|GroceryStore|SupermarketConvenienceStore|ConvenienceStore|HardwareStore|FurnitureStore|PetStore|LiquorStore|MobilePhoneStore|Hotel|Lodging|LodgingBusiness|BedAndBreakfast|TravelAgency|EntertainmentBusiness|MovieTheater|NightClub|EmploymentAgency|Notary|PhotographyBusiness|SelfStorage|ShoppingCenter|TouristAttraction)"[^\]]*\])/i.test(f.jsonLd.join(' '));
  return f;
}

const SOCIAL_HOSTS = [
  ['Instagram', 'instagram.com'],
  ['Facebook', 'facebook.com'],
  ['Yelp', 'yelp.com'],
  ['TikTok', 'tiktok.com'],
];

function buildChecks({ f, finalUrl, ttfbMs, originalUrl }) {
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

// Order matters: pick the problem that is most concrete and most obviously
// costs the owner money, because it has to survive being read in one second in
// an inbox. Vague findings ("improve your SEO") get deleted.
function pickHeadline(failed, ttfbMs, f) {
  const has = (id) => failed.some((c) => c.id === id);

  if (has('mobile')) return 'their site loads desktop-width on a phone, so the text comes up too small to read';
  if (has('https')) return "their site still runs on plain HTTP, so Chrome labels it “Not secure”";
  if (has('speed') && ttfbMs > VERY_SLOW_TTFB_MS)
    return `their site takes over ${Math.floor(ttfbMs / 1000)} seconds to respond, measured from a data centre`;
  if (has('phone')) return 'there is no tap-to-call number anywhere on their site';
  if (has('contact')) return 'there is no form, email, or phone link on their site at all';
  if (has('localseo'))
    return 'their site has no structured business data, so Google cannot show their hours or address in search results';
  if (has('social-preview'))
    return 'their link posts as a bare grey URL with no image when shared in a text or on Instagram';
  if (has('speed')) return `their site takes ${(ttfbMs / 1000).toFixed(1)}s to respond before anything renders`;
  if (has('title')) return 'their page title is missing or truncated in Google results';
  if (has('description'))
    return 'they have no search description, so Google is inventing the text under their link';
  if (has('h1')) return 'their page has no single clear headline for search engines to read';
  if (has('alt-text')) return `${f.imgNoAlt} of their ${f.imgTotal} images have no description`;
  return 'their site is in good shape — worth leading with something other than a technical problem';
}
