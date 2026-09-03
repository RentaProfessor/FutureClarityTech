// Node-side HTML feature extraction.
//
// The Workers build uses HTMLRewriter, which does not exist here. Rather than
// pull in a parser dependency for a research script, this reads the same
// handful of tags with targeted regexes. That is a real limitation: it will
// misread pathological markup (a <title> inside a comment, attributes split
// across lines in unusual ways). It is accurate enough to rank prospects, and
// every finding gets eyeballed before it goes in an email — but do not treat
// this as equivalent to the Workers path.

export function extractFromHtml(html) {
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
    hasFavicon: false,
    generator: '',
    bytes: Buffer.byteLength(html, 'utf8'),
    mapEmbed: false,
    socialLinks: [],
  };

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) f.title = titleM[1].replace(/\s+/g, ' ').trim();

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (tag.match(/\bname\s*=\s*["']([^"']*)["']/i) || [])[1]?.toLowerCase();
    const prop = (tag.match(/\bproperty\s*=\s*["']([^"']*)["']/i) || [])[1]?.toLowerCase();
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (name === 'description') f.metaDescription = content;
    if (name === 'viewport') f.hasViewport = true;
    if (name === 'generator') f.generator = content;
    if (prop === 'og:title') f.ogTitle = true;
    if (prop === 'og:image') f.ogImage = true;
  }

  f.h1Count = (html.match(/<h1\b/gi) || []).length;
  f.formCount = (html.match(/<form\b/gi) || []).length;

  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  f.imgTotal = imgs.length;
  f.imgNoAlt = imgs.filter((t) => {
    const alt = t.match(/\balt\s*=\s*["']([^"']*)["']/i);
    return !alt || alt[1].trim() === '';
  }).length;

  const SOCIAL = [
    ['Instagram', 'instagram.com'],
    ['Facebook', 'facebook.com'],
    ['Yelp', 'yelp.com'],
    ['TikTok', 'tiktok.com'],
  ];
  const social = new Set();
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = ((tag.match(/\bhref\s*=\s*["']([^"']*)["']/i) || [])[1] || '').trim().toLowerCase();
    if (href.startsWith('tel:')) f.telLinks += 1;
    else if (href.startsWith('mailto:')) f.mailtoLinks += 1;
    else for (const [k, host] of SOCIAL) if (href.includes(host)) social.add(k);
  }
  f.socialLinks = [...social];

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = ((tag.match(/\brel\s*=\s*["']([^"']*)["']/i) || [])[1] || '').toLowerCase();
    if (rel.includes('icon')) f.hasFavicon = true;
  }

  for (const tag of html.match(/<iframe\b[^>]*>/gi) || []) {
    const src = ((tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i) || [])[1] || '').toLowerCase();
    if (src.includes('google.com/maps') || src.includes('maps.google')) f.mapEmbed = true;
  }

  const ld = (html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []).join(' ');
  f.localBusinessSchema =
    /"@type"\s*:\s*"[^"]*(LocalBusiness|Restaurant|Store|ProfessionalService|Organization)/i.test(ld);

  return f;
}
