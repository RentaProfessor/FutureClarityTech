// Visit tracking settings. Leave a value empty to turn that tool off.
//
// Cookie-free visit counts come from Cloudflare Web Analytics: turn it on in
// Cloudflare > Workers & Pages > this project > Metrics > Web Analytics. It
// sets no cookies, so it runs for every visitor without the banner.
//
// Google Analytics and Google Ads set cookies, so they load only after a
// visitor says yes in the cookie banner (src/components/Consent.astro). Until
// one of these IDs is filled in, the banner doesn't show on the live site.
export const ANALYTICS = {
  // Google Analytics 4 > Admin > Data streams > your web stream: "G-XXXXXXXXXX"
  ga4Id: 'G-HHSX8K9X0T',
  // Google Ads > Tools > Data manager > Google tag: "AW-XXXXXXXXX"
  adsId: '',
  // Google Ads > Goals > Conversions > your "Quote request" action > tag setup:
  // the part after the slash in send_to, e.g. "AbC-D_efG-h12_34-567"
  adsLeadLabel: '',
};
