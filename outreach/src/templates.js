// Sequence templates. Every body is 50–120 words on purpose (Gong 85M-email
// dataset; Lemlist) and ends in an interest CTA, not a meeting ask (Gong,
// N=304k: interest CTAs book ~2x more meetings). Waits put real weight on
// steps 3+ — that's where the majority of meetings come from (Belkins, 7.5M
// emails). Available fields: {{first_name}} {{business}} {{observation}}
// {{demo_url}} {{sender_name}} (sender_name comes from SENDER_FIRST_NAME in
// wrangler.toml). `observation` is the one specific problem you noticed —
// it is the personalization that ~doubles replies, so never leave it generic.

export const SEQUENCES = {
  restaurant: [
    {
      waitDays: 0,
      subject: 'your menu on phones',
      body: `Hi {{first_name}},

I looked up {{business}} this week — {{observation}}

I run FutureClarity, a small web studio here in LA. We build restaurant sites with working online ordering, and we build a free working demo before anyone pays us anything, so you can click around the real thing first. Here's one we made for a restaurant like yours: {{demo_url}}

Worth a look?

— {{sender_name}}, FutureClarity Technologies`,
    },
    {
      waitDays: 3,
      subject: 're: your menu on phones',
      body: `Hi {{first_name}},

Quick follow-up. The short version: most of your customers find you on their phone, and {{observation}}

If I built a working demo of a {{business}} site — free, no strings — would you take five minutes to look at it?

— {{sender_name}}`,
    },
    {
      waitDays: 4,
      subject: 'built for restaurants like {{business}}',
      body: `Hi {{first_name}},

Last useful thing I can offer over email: the demo site itself — {{demo_url}} — has online ordering, a phone-first menu, and loads fast on bad cell service. That's the build we'd adapt to {{business}}.

Happy to swing by with it on my phone if that's easier than email. Interested?

— {{sender_name}}`,
    },
    {
      waitDays: 5,
      subject: 'closing the loop',
      body: `Hi {{first_name}},

I'll stop here — you're busy running a restaurant. If a better website is ever on the list, the offer stands: working demo first, fixed price, and you deal directly with the person building it.

Either way, good luck with {{business}}.

— {{sender_name}}, FutureClarity Technologies`,
    },
  ],

  retail: [
    {
      waitDays: 0,
      subject: '{{business}} online',
      body: `Hi {{first_name}},

I came across {{business}} — {{observation}}

I run FutureClarity, a small LA web studio. We build storefront sites for shops like yours, and we build a working demo before anyone pays anything, so you react to something real instead of a mockup. Here's a storefront we built: {{demo_url}} — and a live client site: thewhitesquirrelllc.com.

Worth a look?

— {{sender_name}}, FutureClarity Technologies`,
    },
    {
      waitDays: 3,
      subject: 're: {{business}} online',
      body: `Hi {{first_name}},

Following up once — {{observation}} That usually costs shops real walk-ins, since most people check a store's site before visiting.

If I put together a free working demo for {{business}}, would you take five minutes to look?

— {{sender_name}}`,
    },
    {
      waitDays: 4,
      subject: 'the demo, if easier',
      body: `Hi {{first_name}},

Rather than more email: {{demo_url}} is the kind of storefront we'd build for {{business}} — fast, phone-first, easy for you to update yourself.

I'm local, so I'm also happy to stop in and show you on my phone. Interested?

— {{sender_name}}`,
    },
    {
      waitDays: 5,
      subject: 'closing the loop',
      body: `Hi {{first_name}},

Last note from me — you clearly have a shop to run. If {{business}} ever wants a site that pulls its weight, the offer stands: free working demo first so you see the real thing, a fixed price agreed up front, and one person start to finish.

Good luck either way.

— {{sender_name}}, FutureClarity Technologies`,
    },
  ],
};
