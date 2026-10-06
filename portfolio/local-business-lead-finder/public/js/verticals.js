// The kinds of business the Lead Finder searches, in the order the page shows them.
//   k          the business list file it searches: /data/places/<k>.json ("custom" searches other.json)
//   noun, plural   how the audit refers to them ("the next shop", "local repair shops")
//   booking    their customers usually book online, so no online booking counts for more, and the
//              audit suggests a booking page rather than an appointment request form
//   smog       smog checks recur every two years (a small plus in the score)
//   bad        listing types that are usually a poor fit, with a score penalty
//   workflows  what the audit recommends setting up for this kind of business, most useful first
export const VERTICALS = [
  {
    k: 'auto', label: 'Auto repair', noun: 'shop', plural: 'repair shops', booking: false, smog: true,
    bad: [[/auto_dealer|dealer/i, 'Dealership service department', -40]],
    workflows: ['Missed-call text-back', 'Review requests', 'Rebooking nudges', 'Estimates & quotes', 'Online booking + reminders'],
  },
  {
    k: 'groom', label: 'Pet groomers', noun: 'groomer', plural: 'groomers', booking: true,
    bad: [[/veterinar/i, 'Vet clinic (grooming is a side service)', -30]],
    workflows: ['Missed-call text-back', 'Online booking + reminders', 'Rebooking nudges', 'Review requests'],
  },
  {
    k: 'detail', label: 'Auto detailing & tint', noun: 'shop', plural: 'detail shops', booking: true,
    bad: [[/auto_dealer|dealer/i, 'Dealership detail department', -40], [/gas_station|gas station/i, 'Gas station car wash', -30]],
    workflows: ['Estimates & quotes', 'Missed-call text-back', 'Review requests', 'Rebooking nudges'],
  },
  {
    k: 'body', label: 'Auto body & collision', noun: 'shop', plural: 'body shops', booking: false,
    bad: [[/auto_dealer|dealer/i, 'Dealership body shop', -40]],
    workflows: ['Estimates & quotes', 'Missed-call text-back', 'Review requests'],
  },
  {
    k: 'dojo', label: 'Martial arts & fitness', noun: 'school', plural: 'schools', booking: true,
    workflows: ['Missed-call text-back', 'Online booking + reminders', 'Rebooking nudges'],
  },
  {
    k: 'tattoo', label: 'Tattoo studios', noun: 'studio', plural: 'studios', booking: true,
    workflows: ['Online booking + reminders', 'Missed-call text-back', 'Review requests'],
  },
  {
    k: 'barber', label: 'Barbershops & salons', noun: 'shop', plural: 'barbershops', booking: true,
    workflows: ['Online booking + reminders', 'Rebooking nudges', 'Review requests'],
  },
  {
    k: 'custom', label: 'Something else', noun: 'business', plural: 'businesses', booking: true,
    hint: 'Type a kind of local business below, like "HVAC", "florist" or "nail salon". It is matched against the names and categories of the other businesses in the list, and scored the same way.',
    workflows: ['Missed-call text-back', 'Review requests', 'Online booking + reminders'],
  },
];
export const vOf = (k) => VERTICALS.find((v) => v.k === k) || VERTICALS[0];

// National chains and franchises: the person who answers can't say yes, so they're hidden by default.
export const CHAINS = new RegExp('\\b(' + [
  'supercuts', 'great clips', 'sport clips', 'fantastic sams', 'cost cutters', 'smartstyle', 'regis', "floyd'?s 99", 'hair cuttery', 'ulta', 'drybar', 'european wax', 'massage envy', 'hand ?& ?stone', 'elements massage', 'the joint chiropractic', 'amazing lash', 'deka lash', 'the lash lounge', 'regal nails', 'sola salon',
  'jiffy lube', 'valvoline', 'midas', 'meineke', 'firestone', 'pep boys', 'goodyear', 'big o tires', 'les schwab', 'discount tire', "america'?s tire", 'ntb', 'monro', 'christian brothers', 'grease monkey', 'take 5', 'precision tune', 'aamco', 'caliber collision', 'gerber collision', 'maaco', 'service king', 'safelite', 'mister car wash', 'quick quack', 'ziebart', 'tire kingdom', 'just tires', 'brakes plus', 'mavis', 'carstar', 'fix auto', 'abra auto', 'speedee', 'oil changers', 'waterway', 'el car wash', "tommy'?s express",
  'petco', 'petsmart', 'banfield', 'vca', 'dogtopia', 'camp bow wow', 'hounds town', 'woof gang', 'scenthound',
  'orangetheory', 'premier martial arts', 'ata martial arts', 'planet fitness', '24 hour fitness', 'la fitness', 'crunch', 'equinox', "gold'?s gym", 'anytime fitness', 'f45', 'pure barre', 'club pilates', 'corepower', 'yogaworks', 'title boxing', '9round', 'ufc gym', 'snap fitness', 'eos fitness',
  'mathnasium', 'kumon', 'sylvan', 'huntington learning', 'aspen dental', 'western dental', 'bright now', 'pacific dental', 'kaiser',
  'roto-rooter', 'mr\\.? rooter', 'one hour heating', 'benjamin franklin plumbing', 'mister sparky', 'molly maid', 'merry maids', 'the maids', 'trugreen', 'terminix', 'orkin', 'pop-a-lock', 'two men and a truck', 'college hunks',
].join('|') + ')\\b', 'i');
