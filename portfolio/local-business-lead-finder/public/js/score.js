// The fit score: how good a lead a business is, from its listing, its website check and anything
// typed in from Google. 35 to start, plus or minus each signal, kept within 0–100.
// Hot is 60+, Warm 45+, the rest Cold.
//
// Each signal is { k, pts, t, find }: t is its line on the business's card, and find is the
// sentence that goes into "What we found" (the call list's CSV and the pipeline), written to the owner.
import { CHAINS, vOf } from './verticals.js';
import { GENERIC_TITLE, digits, hostOf, known, placeholderOf, placeholderWho, placesOf, usPhone } from './shared.js';

const YEAR = new Date().getFullYear();

// p: a business (a search result or a saved one). siteCache: url → website check, for results whose
// check isn't stored on them yet (null while it runs).
export function assess(p, siteCache) {
  const V = vOf(p.vertical), biz = p.name || 'the business', host = hostOf(p.website);
  const s = p.site && p.site.kind ? p.site : p.website && siteCache ? siteCache.get(p.website) : null;
  const sig = [];
  const add = (k, pts, t, find) => sig.push({ k, pts, t, find: find || '' });
  if (CHAINS.test(p.name || '') || p.chain) add('chain', -45, 'Looks like a chain or franchise');
  const kinds = (p.types || []).join(' ') + ' ' + (p.btype || '');
  (V.bad || []).forEach(([re, t, pts]) => {
    if (re.test(kinds) && !sig.some((x) => x.k === 'bad')) add('bad', pts, t);
  });
  if (!p.phone) add('nophone', 0, 'No phone on the map (look it up on Google)');
  if (V.smog && /smog/i.test((p.name || '') + ' ' + (p.btype || ''))) add('smog', 3, 'Does smog checks (a built-in 2-year reminder)');
  if (p.conf && p.conf < 0.6) add('lowconf', -5, 'Listing may be out of date');

  if (!p.website) add('nosite', 25, 'No website found', `We couldn't find a website for ${biz}. People who look you up can only call, and if nobody picks up they try the next ${V.noun}.`);
  else if (!s) add('checking', 0, 'Checking website…');
  else if (s.kind === 'profile') add('profile', 22, `Website is a ${s.profile.replace(/ \(.*/, '')}`, `Your website link on Google goes to a ${s.profile.replace(/ \(.*/, '')}, not a site of your own.`);
  else if (s.kind === 'unregistered') add('gone', 25, "Web address isn't registered", `Your web address, ${host}, isn't registered to anyone anymore, so it doesn't load and anyone could buy it.`);
  else if (s.kind === 'expired') add('gone', 25, 'Domain registration expired', `Your web address, ${host}, has expired, so your website doesn't come up anymore.`);
  else if (s.kind === 'parked' || s.parked) add('parked', 25, `Website domain ${s.sale ? 'is for sale' : 'shows a parking page'}${s.by ? ` (${s.by})` : ''}`, `Your web address, ${host}, shows ${s.sale ? 'a "for sale" page' : 'a parking page'}${s.by ? ` from ${s.by}` : ''} instead of your business.`);
  else if (s.kind === 'placeholder') add('placeholder', 25, placeholderOf(s).signal, `Your web address, ${host}, ${placeholderOf(s).shows.replace('{by}', placeholderWho(s))}.`);
  else if (s.kind === 'down') add('down', 25, 'Website is broken', `Your website didn't load when we tried it (${s.error || 'error'}).`);
  else if (s.kind !== 'site') add('unknown', 0, "Couldn't check the website");
  else if (s.notMine) add('notmine', 20, "Website doesn't mention them", `The website on your listing, ${hostOf(s.finalUrl || p.website)}, doesn't mention ${biz}, so it may not be yours anymore.`);
  else {
    if (s.thin) add('thin', 10, 'Website is nearly empty', 'Your website has almost nothing on it.');
    const tools = s.tools || [], suite = tools.find((t) => t.suite);
    if (suite) add('suite', -18, `Already uses ${suite.name}`);
    else if (tools[0]) add('tool', 0, `Books online with ${tools[0].name}`);
    else if (!s.bookingWords) add('nobook', V.booking ? 18 : 10, 'No online booking', "There's no way to book online from your website.");
    if (!s.mobile) add('nomobile', 12, "Site isn't built for phones", "Your website isn't set up for phones, which is where most people look you up.");
    if (!s.https) add('nohttps', 5, 'Site shows "Not secure"', 'Browsers mark your website "Not secure" because it doesn\'t use https.');
    if (s.year && s.year <= YEAR - 3) add('stale', 8, `Site footer says ${s.year}`, `Your website's footer says ${s.year}, so it can look out of date to new customers.`);
    if (s.mobile && !s.tel) add('notel', 4, 'No tap-to-call button', "There's no tap-to-call button on your website.");
    if (s.ms > 5000) add('slow', 5, `Site is slow (${Math.round(s.ms / 1000)}s)`, `Your website took about ${Math.round(s.ms / 1000)} seconds to load.`);
    if (s.freeHost) add('freehost', 6, `Site is on a free ${s.freeHost} address`, `Your website is on a free ${s.freeHost} address (${hostOf(s.finalUrl || p.website)}) instead of a web address of your own.`);
    // Google basics (checks from before these existed have no seo field)
    const g = s.seo, area = placesOf(p)[0];
    if (g && g.noindex) add('noindex', 12, 'Site is hidden from Google', 'Your website is set to hide from Google (a "noindex" setting), so it doesn\'t show up in search.');
    else if (g) {
      const gaps = [!s.title ? 'no page title' : GENERIC_TITLE.test(s.title) ? `a page title that just says "${s.title}"` : '', !g.desc && 'no description for Google',
        s.onPage && s.onPage.area === false && area && `no mention of ${area}`, !g.schema && 'no business details for Google'].filter(Boolean);
      if (gaps.length >= 2) add('seo', 6, 'Weak on Google basics', `Your website is missing a few basics that help Google show it to people nearby: ${gaps.join(', ')}.`);
    }
    // the call button dials a number that isn't the listing's, or the listing's number is nowhere on the page
    const listed = digits(p.phone), dials = (s.phones || []).filter((d) => d !== listed);
    if (listed.length === 10 && dials.length && !(s.phones || []).includes(listed)) add('phonediff', 8, 'Site dials a different number', `The call button on your website dials ${usPhone(dials[0])}, but your Google listing says ${p.phone}.`);
    else if (s.onPage && s.onPage.phone === false && p.phone) add('napphone', 3, "Listing's phone isn't on their site", `The phone number on your listing, ${p.phone}, isn't on your website, and Google trusts a business more when its details match everywhere.`);
  }

  const n = known(p.reviews) ? +p.reviews : 0, r = known(p.rating) ? +p.rating : null;
  if (!known(p.reviews)) add('reviewsunknown', 0, 'Google rating: not added yet');
  else if (!n) add('noreviews', 15, 'No Google reviews', `There are no Google reviews for ${biz} yet.`);
  else if (n < 25) add('fewreviews', 14, `Only ${n} reviews`, `You have ${n} Google reviews; the ${V.plural} that show up first nearby usually have far more.`);
  else if (n < 80) add('somereviews', 7, `${n} reviews`, `You have ${n} Google reviews; a steady stream of new ones helps you show up first.`);
  if (r !== null && known(p.reviews) && n) {
    if (r < 4.0) add('lowrating', 10, `Rated ${r.toFixed(1)}`, `Your Google rating is ${r.toFixed(1)}. Asking every customer for a review is the fastest way to lift it.`);
    else if (r < 4.4) add('okrating', 5, `Rated ${r.toFixed(1)}`, `Your Google rating is ${r.toFixed(1)}; asking every customer for a review would push it up.`);
  }

  const score = Math.max(0, Math.min(100, 35 + sig.reduce((t, x) => t + x.pts, 0)));
  return { score, level: score >= 60 ? 'Hot' : score >= 45 ? 'Warm' : 'Cold', sig, pending: sig.some((x) => x.k === 'checking') };
}

// The problems worth telling the owner about, biggest first.
export const findings = (a) => a.sig.filter((x) => x.pts > 0 && x.find).sort((x, y) => y.pts - x.pts);
// The signals as stored with a saved business.
export const slim = (a) => a.sig.filter((x) => x.k !== 'checking').map(({ k, pts, t }) => ({ k, pts, t }));
