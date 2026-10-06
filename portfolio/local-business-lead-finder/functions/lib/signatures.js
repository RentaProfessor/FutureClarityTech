// What the website checker recognizes. Almost all of it is plain text, matched against host names
// and against the start of each link on a page (site-check.js compiles the link signatures into a
// single pattern), plus the words that parked and placeholder pages use.

// A "website" that is really a profile or listing somewhere else.
export const PROFILE_HOSTS = [
  [['facebook.com', 'fb.com'], 'Facebook page'], [['instagram.com'], 'Instagram profile'],
  [['linktr.ee', 'linkin.bio', 'beacons.ai'], 'link-in-bio page'], [['yelp.com'], 'Yelp page'],
  [['business.site', 'negocio.site'], 'Google business.site page (Google shut these down in 2024)'],
  [['sites.google.com'], 'Google Sites page'], [['g.page', 'maps.app.goo.gl', 'maps.google.com'], 'Google Maps listing'],
  [['tiktok.com'], 'TikTok profile'], [['booksy.com'], 'Booksy profile'], [['vagaro.com'], 'Vagaro profile'],
  [['styleseat.com'], 'StyleSeat profile'], [['fresha.com'], 'Fresha profile'], [['squareup.com'], 'Square booking page'],
  [['glossgenius.com', 'gloss.genius'], 'GlossGenius page'], [['getsquire.com'], 'Squire page'], [['thecut.co'], 'theCut profile'],
  [['nextdoor.com'], 'Nextdoor page'], [['hub.biz'], 'Hub.biz listing'], [['localgads.com'], 'LocalGads listing'],
  [['yellowpages.com'], 'Yellow Pages listing'], [['manta.com'], 'Manta listing'], [['mapquest.com'], 'MapQuest listing'],
  [['bbb.org'], 'BBB listing'], [['chamberofcommerce.com'], 'Chamber of Commerce listing'], [['carfax.com'], 'Carfax listing'],
  [['mechanicadvisor.com'], 'MechanicAdvisor listing'], [['repairpal.com'], 'RepairPal listing'], [['openbay.com'], 'Openbay listing'],
  [['angi.com', 'homeadvisor.com'], 'Angi listing'], [['thumbtack.com'], 'Thumbtack listing'], [['groupon.com'], 'Groupon page'],
];

// Domain marketplaces, registrars and parking services. An address that redirects to one is for sale
// or parked, not a website.
export const MARKETS = [
  [['godaddy.com'], 'GoDaddy'], [['afternic.com'], 'Afternic'], [['dan.com'], 'Dan.com'], [['sedo.com', 'sedoparking.com'], 'Sedo'],
  [['hugedomains.com'], 'HugeDomains'], [['buydomains.com'], 'BuyDomains'], [['undeveloped.com'], 'Undeveloped'],
  [['domainmarket.com'], 'DomainMarket'], [['atom.com', 'squadhelp.com'], 'Atom'], [['brandbucket.com'], 'BrandBucket'],
  [['efty.com'], 'Efty'], [['sav.com'], 'Sav'], [['bodis.com'], 'Bodis'], [['parkingcrew.net'], 'ParkingCrew'], [['above.com'], 'Above.com'],
  [['dynadot.com'], 'Dynadot'], [['namecheap.com'], 'Namecheap'], [['domainnamesales.com'], 'DomainNameSales'], [['epik.com'], 'Epik'],
  [['spaceship.com'], 'Spaceship'], [['porkbun.com'], 'Porkbun'], [['perfectdomain.com'], 'PerfectDomain'], [['uniregistry.com'], 'Uniregistry'],
  [['domainagents.com'], 'DomainAgents'], [['name.com'], 'Name.com'],
];
// The marketplaces among them: a redirect there means the domain is for sale, not just parked.
export const SALE_HOSTS = new Set(['Afternic', 'Dan.com', 'Sedo', 'HugeDomains', 'BuyDomains', 'Undeveloped', 'DomainMarket', 'Atom',
  'BrandBucket', 'Efty', 'DomainNameSales', 'PerfectDomain', 'DomainAgents']);
// Words that say the domain itself is for sale (a parking page alone may just be an unused domain).
export const SALE_WORDS = /for sale|buy this domain|get this domain|make an offer|inquire about this domain|interested in this domain|may still be available/;

// Hosting companies' and site builders' own homepages: sending visitors there means the site isn't
// set up or the plan ended. Exact names only: yourshop.weebly.com is a real (free) site.
export const HOST_HOMES = {
  'wix.com': 'Wix', 'squarespace.com': 'Squarespace', 'shopify.com': 'Shopify', 'weebly.com': 'Weebly', 'web.com': 'Web.com',
  'networksolutions.com': 'Network Solutions', 'register.com': 'Register.com', 'ionos.com': 'IONOS', '1and1.com': 'IONOS',
  'hostinger.com': 'Hostinger', 'bluehost.com': 'Bluehost', 'hostgator.com': 'HostGator', 'dreamhost.com': 'DreamHost',
  'siteground.com': 'SiteGround', 'wordpress.com': 'WordPress.com', 'godaddysites.com': 'GoDaddy',
};
// A real site, but on a free address from its builder instead of the business's own domain.
export const FREE_HOSTS = [
  [['wixsite.com', 'editorx.io'], 'Wix'], [['godaddysites.com'], 'GoDaddy'], [['weebly.com', 'weeblysite.com'], 'Weebly'], [['square.site'], 'Square'],
  [['squarespace.com'], 'Squarespace'], [['wordpress.com'], 'WordPress.com'], [['myshopify.com'], 'Shopify'], [['carrd.co'], 'Carrd'],
  [['webflow.io'], 'Webflow'], [['jimdosite.com'], 'Jimdo'], [['mystrikingly.com'], 'Strikingly'], [['site123.me'], 'SITE123'],
];

// Booking and shop-management tools, found by their script, iframe or link on the page:
// [name, signatures, suite]. suite = an all-in-one that already sends reminders and review requests.
// A signature ending in "\n" must end the link (thecut.co, not thecut.com).
export const TOOLS = [
  ['Booksy', ['booksy.com'], true], ['Vagaro', ['vagaro.com'], true], ['Fresha', ['fresha.com', 'shedul.com'], true],
  ['GlossGenius', ['glossgenius.com'], true], ['Squire', ['getsquire.com'], true], ['theCut', ['thecut.co/', 'thecut.co\n'], true],
  ['StyleSeat', ['styleseat.com'], true], ['Boulevard', ['joinblvd.com', 'blvd.co/', 'blvd.co\n'], true], ['Zenoti', ['zenoti.com'], true],
  ['Mangomint', ['mangomint.com'], true], ['Phorest', ['phorest.com'], true], ['Mindbody', ['mindbodyonline.com', 'healcode.com', 'mindbody.io'], true],
  ['Schedulicity', ['schedulicity.com'], false], ['Square Appointments', ['squareup.com/appointments', 'book.squareup.com'], false],
  ['Acuity', ['acuityscheduling.com', 'squarespacescheduling.com'], false], ['Calendly', ['calendly.com'], false], ['Setmore', ['setmore.com'], false],
  ['SimplyBook', ['simplybook.me', 'simplybook.it'], false], ['Timely', ['gettimely.com'], true],
  ['Tekmetric', ['tekmetric.com'], true], ['Shopmonkey', ['shopmonkey.io', 'shopmonkey.com'], true], ['Mitchell 1', ['mitchell1.com', 'mitchellsocial', 'shopkeypro'], true],
  ['AutoVitals', ['autovitals.com'], true], ['Kukui', ['kukui.com'], true], ['Steer', ['steercrm.com'], true], ['RepairPal', ['repairpal.com'], false],
  ['Autoshop Solutions', ['autoshopsolutions.com'], true], ['Shopgenie', ['shopgenie.io'], true], ['Demandforce', ['demandforce.com'], true],
  ['Broadly', ['broadly.com'], true], ['Openbay', ['openbay.com'], false], ['Urable', ['urable.com'], true], ['Mobile Tech RX', ['mobiletechrx.com'], true],
  ['MoeGo', ['moego.pet'], true], ['Gingr', ['gingrapp.com'], true], ['PetExec', ['petexec.net'], true], ['DaySmart Pet', ['123pet.com', 'daysmartpet'], true],
  ['ServiceTitan', ['servicetitan.com'], true], ['Housecall Pro', ['housecallpro.com'], true], ['Jobber', ['getjobber.com'], true], ['Workiz', ['workiz.com'], true],
  ['Glofox', ['glofox.com'], true], ['Wodify', ['wodify.com'], true], ['Zen Planner', ['zenplanner.com'], true], ['PushPress', ['pushpress.com'], true],
  ['Kicksite', ['kicksite.net'], true], ['Spark Membership', ['sparkmembership'], true], ['Gymdesk', ['gymdesk.com'], true], ['Pike13', ['pike13.com'], true],
  ['Podium', ['podium.com'], true], ['Birdeye', ['birdeye.com'], true], ['NiceJob', ['nicejob.co'], true], ['Weave', ['getweave.com'], true],
  ['NexHealth', ['nexhealth.com'], true], ['Zocdoc', ['zocdoc.com'], false],
];

// Everything else worth knowing for the audit's suggestions: [group, name, signatures].
export const EXTRAS = [
  ['analytics', 'Google Analytics', ['google-analytics.com', 'googletagmanager.com']], ['analytics', 'Meta Pixel', ['connect.facebook.net']],
  ['chat', 'Tawk.to', ['tawk.to']], ['chat', 'Tidio', ['tidio.co']], ['chat', 'Intercom', ['intercom.io', 'intercom.com', 'intercomcdn.com']],
  ['chat', 'Drift', ['drift.com', 'driftt.com']], ['chat', 'LiveChat', ['livechatinc.com']], ['chat', 'Zendesk', ['zdassets.com', 'zopim.com']],
  ['chat', 'HubSpot', ['usemessages.com', 'hs-scripts.com']], ['chat', 'Crisp', ['crisp.chat']], ['chat', 'Olark', ['olark.com']],
  ['chat', 'Freshchat', ['freshchat.com']], ['chat', 'JivoChat', ['jivosite.com']], ['chat', 'Smartsupp', ['smartsupp']],
  ['pay', 'Stripe', ['stripe.com']], ['pay', 'Square', ['squarecdn.com', 'square.link', 'checkout.square.site']], ['pay', 'PayPal', ['paypal.com', 'paypalobjects.com']],
  ['pay', 'Clover', ['clover.com']], ['pay', 'Affirm', ['affirm.com']], ['pay', 'Synchrony financing', ['synchrony']], ['pay', 'Snap Finance', ['snapfinance.com']],
  ['pay', 'Sunbit', ['sunbit.com']], ['pay', 'Acima', ['acima.com']], ['pay', 'Koalafi', ['koalafi.com']],
  ['mail', 'Mailchimp', ['list-manage.com', 'chimpstatic.com', 'mailchimp.com']], ['mail', 'Klaviyo', ['klaviyo.com']],
  ['mail', 'Constant Contact', ['ctctcdn.com', 'constantcontact.com']], ['mail', 'MailerLite', ['mailerlite.com']],
  ['reviews', 'Elfsight', ['elfsight.com']], ['reviews', 'Trustindex', ['trustindex.io']], ['reviews', 'Trustpilot', ['trustpilot.com']], ['reviews', 'EmbedSocial', ['embedsocial.com']],
  ['app', 'App Store', ['apps.apple.com', 'itunes.apple.com']], ['app', 'Google Play', ['play.google.com']],
  ['form', 'form', ['jotform.com', 'typeform.com', 'wufoo.com', 'formstack.com', 'cognitoforms.com', '123formbuilder', 'hsforms.com', 'hsforms.net', 'forms.gle',
    'docs.google.com/forms', 'paperform.co', 'tally.so', 'formsite.com', 'formspree.io', 'getform.io', 'web3forms']],
];

// Site builders, by what their pages load. The first match wins.
export const BUILDERS = [
  ['Wix', ['wixstatic.com', 'wix.com', 'wixsite.com']], ['Squarespace', ['squarespace']], ['GoDaddy', ['img1.wsimg.com', 'godaddysites.com']],
  ['WordPress', ['wp-content', 'wp-includes']], ['Weebly', ['weebly']], ['Square Online', ['editmysite.com', 'square.site']], ['Shopify', ['cdn.shopify.com']],
  ['Duda', ['multiscreensite', 'dudaone', 'irp.cdn-website.com']], ['Webflow', ['webflow', 'website-files.com']],
];

// What a for-sale or parked page loads (matched against its links). A signature starting with "\n"
// must start the link (dan.com, not jordan.com)...
export const PARKED_CODE = [
  [['wsimg.com/parking-lander'], 'GoDaddy'], [['sedoparking.com', 'sedo.com/'], 'Sedo'], [['parkingcrew.net'], 'ParkingCrew'], [['bodis.com'], 'Bodis'],
  [['afternic.com'], 'Afternic'], [['\ndan.com/', '\nwww.dan.com/'], 'Dan.com'], [['hugedomains.com'], 'HugeDomains'], [['undeveloped.com'], 'Undeveloped'],
  [['parkingpage.namecheap.com'], 'Namecheap'], [['\nabove.com/', '\nwww.above.com/'], 'Above.com'], [['domainmarket.com'], 'DomainMarket'],
  [['buydomains.com'], 'BuyDomains'], [['parklogic.com'], 'ParkLogic'],
];
// ...and what it says. Only checked near the top of small pages, where a real site's text can't trip it.
export const PARKED_WORDS = /domain(?: name)? (?:is|may be) for sale|this domain is for sale|buy this domain|get this domain|make an offer on this domain|inquire about this domain|interested in this domain|is registered, but may still be available|parked free|parked for free|this domain(?: name)? is parked|parked domain|domain parking|pending renewal or deletion|this domain(?: name)? has expired|domain(?: name)? (?:has )?expired on|related searches/;

// Pages that hold a domain's place: [reason, words]. These are distinctive enough to check on any page.
export const PLACEHOLDERS = [
  ['coming soon', /future home of something|log in to launch this site/],
  ['default page', /welcome to nginx|apache2 (?:ubuntu|debian) default page|test page for the apache|<h1>\s*it works!|<title>\s*(?:index of \/|iis windows server|domain default page|default web ?site page)|there is no website configured at this address|if you are the owner of this website, please contact your hosting provider|this page is generated by plesk/],
  ['suspended', /account (?:has been )?suspended|this (?:website|site|account) (?:has been|is) suspended/],
  ['expired', /this website has expired|website expired|hosting (?:account )?(?:has )?expired|your site has expired/],
  ['not connected', /isn['’]?t connected to a website|is not connected to a website|domain is not connected|only one step left|store is currently unavailable|shop is currently unavailable|there isn['’]?t a github pages site here|no such app/],
];
// All of them in one pattern, one group per reason.
export const PLACEHOLDER_RE = new RegExp(PLACEHOLDERS.map(([, re]) => `(${re.source})`).join('|'));
// Weaker words: only in the page title or on a small page.
export const SOON = [['coming soon', /coming soon|launching soon|under construction/], ['unavailable', /currently unavailable|temporarily unavailable|no longer available/]];

// schema.org business details ("structured data") that tell Google the name, address, hours and kind.
export const BIZ_TYPES = /"@type"\s*:\s*\[?\s*"(?:localbusiness|automotivebusiness|autorepair|autobodyshop|autowash|autopartsstore|autodealer|tireshop|motorcyclerepair|beautysalon|hairsalon|nailsalon|dayspa|healthandbeautybusiness|tattooparlor|exercisegym|healthclub|sportsactivitylocation|petstore|veterinarycare|homeandconstructionbusiness|hvacbusiness|plumber|electrician|locksmith|housepainter|roofingcontractor|generalcontractor|movingcompany|professionalservice|drycleaningorlaundry|store|medicalbusiness|childcare|foodestablishment|bakery|florist)"/;

// Words in a business name that any shop could share, so they can't tell its own site from another.
export const COMMON_WORDS = new Set(('the and of in at by for to inc llc co corp company group auto autos automotive repair repairs service services center centre ' +
  'shop shops store smog check test station tire tires wheel wheels body collision paint car cars truck trucks mobile mechanic mechanics garage ' +
  'transmission transmissions brake brakes muffler exhaust oil lube change tune engine diesel electric electrical glass tint tinting detail ' +
  'detailing wash spa salon barber barbers barbershop beauty hair nails nail studio studios tattoo tattoos piercing grooming groomer groomers pet ' +
  'pets dog dogs cat martial arts academy fitness gym boxing karate kids club los angeles valley north south east west san fernando van nuys ' +
  'hollywood burbank glendale city express pro pros plus best quality professional premier elite expert experts family').split(' '));
// Of those, the ones that don't name a trade.
export const FILLER = new Set(('inc corp company group center centre service services store shop shops city express plus best quality professional ' +
  'premier elite expert experts family club kids north south east west valley angeles hollywood burbank glendale fernando nuys pros').split(' '));

// Placeholder, tracking and image-name matches that look like addresses but aren't anyone's inbox.
export const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|[@.](example|domain|email|yourdomain|yoursite|mysite|company|sentry|wixpress|godaddy)\.[a-z.]+$|^(no-?reply|name|you|your|user|username|email|firstname|john\.?doe|jane\.?doe)@/i;

// Nameservers that only ever serve parked or for-sale domains (from the domain's registry record).
export const PARKING_NS = [
  [/sedoparking\.com$/, 'Sedo'], [/parkingcrew\.net$/, 'ParkingCrew'], [/bodis\.com$/, 'Bodis'], [/(^|\.)above\.com$/, 'Above.com'],
  [/(^|\.)dan\.com$/, 'Dan.com'], [/afternic\.com$/, 'Afternic'], [/undeveloped\.com$/, 'Undeveloped'], [/namebrightdns\.com$/, 'NameBright'],
  [/uniregistrymarket\.link$/, 'Uniregistry'], [/fabulous\.com$/, 'Fabulous'], [/dsredirection\.com$/, 'DomainSponsor'], [/parklogic\.com$/, 'ParkLogic'],
  [/hugedomains\.com$/, 'HugeDomains'], [/domainmarket\.com$/, 'DomainMarket'], [/buydomains\.com$/, 'BuyDomains'], [/brandbucket\.com$/, 'BrandBucket'],
];
