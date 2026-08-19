// Redirect the Cloudflare Pages preview hostname to the custom domain.
//
// Cloudflare Pages serves this project on BOTH futureclaritytech.pages.dev and
// futureclaritytechnologies.com. Two hostnames serving identical content is a
// duplicate, and Google picks one as canonical. The <link rel="canonical"> tag
// (driven by `site` in astro.config.mjs) already tells it which to prefer; this
// 301 makes it unambiguous and passes any accumulated ranking signal across.
//
// Matched by exact hostname on purpose: deploy previews live at
// <hash>.futureclaritytech.pages.dev and must keep working for QA, so a
// .endsWith('.pages.dev') check would be wrong here.
const CANONICAL_HOST = 'futureclaritytechnologies.com';
const REDIRECT_FROM = new Set(['futureclaritytech.pages.dev']);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (REDIRECT_FROM.has(url.hostname)) {
    url.hostname = CANONICAL_HOST;
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
}
