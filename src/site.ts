// Single source of truth for contact and booking details used across the site.
export const SITE = {
  // NOTE: switch DNS on first — enable Cloudflare Email Routing (free) for
  // futureclaritytechnologies.com and forward hello@ to the Gmail inbox
  // BEFORE this address goes live, or mail to it will bounce.
  email: 'hello@futureclaritytechnologies.com',
  phoneDisplay: '+1 (818) 585-0475',
  phoneTel: '+18185850475',
  // Create a free Cal.com account, then paste the event URL here
  // (e.g. 'https://cal.com/futureclarity/intro') to show the
  // "Book an intro call" buttons. They stay hidden while this is empty.
  calUrl: '',
  city: 'Los Angeles',
};
