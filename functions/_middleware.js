// Force every request onto the custom domain.
//
// Cloudflare Pages serves this project on *.pages.dev as well as
// futureclaritytechnologies.com. Two hostnames serving identical content is a
// duplicate, and Google picks one of them as canonical — it picked the
// pages.dev copy, which is why brand searches surfaced that URL.
//
// A 301 (not a 404, and not blocking the host) is deliberate: Google has to be
// able to FETCH the pages.dev URL and see the redirect in order to consolidate
// the two and drop the old one. Disabling the pages.dev subdomain would break
// that and strand the signal.
//
// This matches ANY *.pages.dev hostname, which includes branch aliases like
// main.<project>.pages.dev and per-deployment preview URLs. That is intentional:
// the requirement is that pages.dev never appears publicly. If you later want
// deploy previews to stay browsable for QA, change the test to an exact match:
//     if (url.hostname === 'futureclaritytech.pages.dev')
// and previews will work again while the production alias still redirects.
const CANONICAL_HOST = 'futureclaritytechnologies.com';

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Exception: let Google's site-verification file through on pages.dev.
  //
  // Search Console's Removals tool only accepts URLs from a property you have
  // verified, and verification works by fetching google<token>.html from the
  // host itself. If that request redirects, verification fails and the pages.dev
  // property can never be created -- which is exactly the property we need in
  // order to request removal of pages.dev URLs. So this one path must be served
  // on pages.dev even though everything else redirects.
  if (/^\/google[0-9a-f]+\.html$/.test(url.pathname)) {
    return context.next();
  }

  // `wrangler pages dev` serves on localhost; never redirect that away.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return context.next();
  }

  // www.<canonical> is folded in alongside *.pages.dev. It previously had no
  // DNS record at all, so anyone who typed the www form got a DNS failure
  // rather than the site; once www is a Pages custom domain it reaches this
  // worker, and this 301 keeps it from becoming a duplicate of the apex in
  // Google's index.
  //
  // Deliberately NOT widened to "any host that is not canonical" -- that also
  // swallows per-deployment preview URLs and makes QA on a preview impossible.
  if (url.hostname.endsWith('.pages.dev') || url.hostname === `www.${CANONICAL_HOST}`) {
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    // 301 = permanent. Google transfers ranking signals and drops the old URL.
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
