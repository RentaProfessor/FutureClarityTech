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

  if (url.hostname.endsWith('.pages.dev')) {
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    // 301 = permanent. Google transfers ranking signals and drops the old URL.
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
