#!/usr/bin/env python3
"""Build the Lead Finder's business list from Overture Maps open data.

Writes public/data/places/*.json: one compact file per kind of business in the area below,
plus meta.json (the release, counts, and the neighborhoods, cities and ZIP codes in the area
with their map centers, for the place box).

The page reads these files from the same site, so a search needs no outside server, key or
account. Re-run this to pick up Overture's latest monthly release:

    pip install -r scripts/requirements.txt
    python scripts/build-places.py

Overture publishes every place in the world as a set of large GeoParquet files. This reads them
over HTTP without downloading them whole: each file's footer has min/max statistics for every
row group, so only the row groups whose bounding boxes overlap the area are fetched, and only
the columns used here.

Data: Overture Maps Foundation places theme (CDLA-Permissive-2.0; includes data from
Meta, Microsoft, Foursquare and others). See https://docs.overturemaps.org/attribution/
"""
import collections
import json
import os
import re
import statistics
import sys
import urllib.request
from datetime import date

BUCKET = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'places')

# The San Fernando Valley plus Calabasas/Agoura, Burbank, Glendale, the Hollywood Hills and west Pasadena.
WEST, SOUTH, EAST, NORTH = -118.80, 34.08, -118.15, 34.36
COVERAGE = 'the San Fernando Valley and nearby, from Calabasas to Glendale'  # shown when a search is outside the box
MIN_CONFIDENCE = 0.35  # below this, Overture listings are often stale or duplicates

# Overture taxonomy (taxonomy.primary) for each kind of business on the page.
GROUPS = {
    'auto': ['automotive_repair', 'automotive_service', 'tire_dealer_and_repair', 'tire_shop', 'emissions_inspection', 'car_inspection',
             'oil_change_station', 'transmission_repair', 'brake_service_and_repair', 'engine_repair_service', 'auto_electrical_repair',
             'exhaust_and_muffler_repair', 'wheel_and_rim_repair', 'truck_repair', 'motorcycle_repair'],
    'body': ['auto_body_shop', 'auto_restoration_service'],
    'detail': ['car_wash', 'auto_detailing', 'car_window_tinting', 'auto_customization', 'vehicle_wrap', 'auto_upholstery'],
    'groom': ['pet_groomer'],
    'tattoo': ['tattoo_and_piercing', 'tattoo'],
    'barber': ['barber', 'hair_salon', 'beauty_salon', 'hair_stylist', 'kids_hair_salon', 'mens_grooming_salon'],
    'dojo': ['martial_arts_club', 'chinese_martial_arts_club', 'boxing_gym', 'gym'],
    # "Something else": other appointment and walk-in businesses.
    'other': ['nail_salon', 'massage_therapy', 'spa', 'day_spa', 'medical_spa', 'chiropractic', 'physical_therapy', 'acupuncture',
              'hvac_service', 'plumbing', 'electrician', 'home_cleaning', 'carpet_cleaning', 'cleaning_service', 'pool_cleaning',
              'dry_cleaning', 'laundromat', 'key_and_locksmith', 'tutoring_service', 'private_tutor', 'music_school', 'dance_studio',
              'yoga_studio', 'pilates_studio', 'florist', 'tailor', 'furniture_reupholstery', 'pet_boarding', 'pet_sitting',
              'dog_trainer', 'veterinarian', 'landscaping', 'pest_control_service', 'photography_service', 'event_photography_service',
              'session_photography_service', 'towing_service', 'auto_glass_service', 'windshield_installation_and_repair',
              'auto_security', 'car_stereo_installation', 'electronics_repair_shop', 'appliance_repair_service', 'computer_repair_service',
              'mobile_phone_repair', 'shoe_repair', 'watch_repair_service', 'jewelry_repair_service', 'handyman', 'painting',
              'roofing', 'moving_and_storage', 'driving_school', 'skin_care_and_makeup', 'eyelash_service', 'waxing', 'hair_removal',
              'personal_trainer', 'swimming_lessons', 'art_school', 'bakery', 'catering', 'printing_service', 'sign_making',
              'bike_repair_maintenance', 'locksmith'],
}
COLS = ['id', 'names.primary', 'taxonomy.primary', 'confidence', 'websites', 'phones', 'emails', 'socials', 'brand.wikidata',
        'addresses', 'operating_status', 'bbox']
# The page reads each row by position: keep this in step with fromRow() in public/js/places.js.
FIELDS = ['id', 'name', 'lat', 'lon', 'type', 'phone', 'website', 'email', 'social', 'street', 'city', 'zip', 'confidence', 'chain']
SOCIAL = re.compile(r'facebook\.com|instagram\.com|yelp\.com|linktr\.ee|tiktok\.com|twitter\.com|x\.com', re.I)


# ---------------------------------------------------------------- Overture's files

def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode()


def latest_release():
    xml = fetch(BUCKET + '?list-type=2&prefix=release/&delimiter=/')
    rels = sorted(re.findall(r'<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>', xml))
    if not rels:
        sys.exit('No Overture releases found')
    return rels[-1]


def place_files(release):
    xml = fetch(BUCKET + f'?list-type=2&prefix=release/{release}/theme=places/type=place/')
    return [BUCKET + k for k in re.findall(r'<Key>([^<]+\.parquet)</Key>', xml)]


def overlapping_row_groups(metadata, box=(WEST, SOUTH, EAST, NORTH)):
    """The row groups whose bounding-box statistics overlap the box: the only ones worth fetching."""
    west, south, east, north = box
    idx = {metadata.schema.column(i).path: i for i in range(metadata.num_columns)}
    groups = []
    for g in range(metadata.num_row_groups):
        rg = metadata.row_group(g)
        s = lambda c: rg.column(idx[c]).statistics  # noqa: E731 (one line per bound reads best)
        if s('bbox.xmax').max < west or s('bbox.xmin').min > east or s('bbox.ymax').max < south or s('bbox.ymin').min > north:
            continue
        groups.append(g)
    return groups


def in_box(table, box=(WEST, SOUTH, EAST, NORTH)):
    """The rows of a table whose place (its bounding box's corner) is inside the box."""
    import pyarrow.compute as pc
    west, south, east, north = box
    b = table.column('bbox')
    x, y = pc.struct_field(b, 'xmin'), pc.struct_field(b, 'ymin')
    keep = pc.and_(pc.and_(pc.greater_equal(x, west), pc.less_equal(x, east)), pc.and_(pc.greater_equal(y, south), pc.less_equal(y, north)))
    return table.filter(keep)


def read_area(release):
    """Every place in the box, as dicts, reading only the row groups that can hold one."""
    import fsspec
    import pyarrow as pa
    import pyarrow.parquet as pq
    fs = fsspec.filesystem('https', client_kwargs={'trust_env': True}, block_size=8 * 2**20)
    tables = []
    for url in place_files(release):
        with fs.open(url, 'rb') as f:
            pf = pq.ParquetFile(f)
            groups = overlapping_row_groups(pf.metadata)
            for i in range(0, len(groups), 8):
                tables.append(in_box(pf.read_row_groups(groups[i:i + 8], columns=COLS)))
            if groups:
                print(f'  {url[-70:-44]}: {len(groups)} row groups', flush=True)
    return pa.concat_tables(tables).to_pylist()


# ---------------------------------------------------------------- one place

def phone(v):
    """A US number as (818) 555-0100; anything else as it was."""
    d = re.sub(r'\D', '', v or '')
    if len(d) == 11 and d.startswith('1'):
        d = d[1:]
    return f'({d[:3]}) {d[3:6]}-{d[6:]}' if len(d) == 10 else (v or '').strip()


def first(xs, test=lambda x: True):
    for x in xs or []:
        if x and test(x):
            return x
    return ''


def usable(r):
    """Open, and confident enough to be worth a call."""
    return (r.get('operating_status') or 'open') == 'open' and (r.get('confidence') or 0) >= MIN_CONFIDENCE


def dedupe_key(name, tel, lat, lon):
    """The same business listed twice: the same name (ignoring case and punctuation) and phone,
    or, without a phone, the same spot."""
    return re.sub(r'[^a-z0-9]', '', name.lower()), re.sub(r'\D', '', tel)[-10:] or f'{lat:.4f},{lon:.4f}'


def place_row(r):
    """One place as a list row (FIELDS), with its category name in the type slot."""
    name = ((r.get('names') or {}).get('primary') or '').strip()
    lon, lat = r['bbox']['xmin'], r['bbox']['ymin']
    a = (r.get('addresses') or [{}])[0] or {}
    # a website of its own before a social profile, and Facebook or Instagram before other socials
    web = first(r.get('websites'), lambda u: not SOCIAL.search(u)) or first(r.get('websites'))
    social = first(r.get('socials'), lambda u: re.search(r'facebook\.com|instagram\.com', u, re.I)) or first(r.get('socials'))
    return [
        r['id'][:16], name, round(lat, 5), round(lon, 5), (r.get('taxonomy') or {}).get('primary') or '', phone(first(r.get('phones'))),
        web, (first(r.get('emails')) or '').lower(), social, (a.get('freeform') or '').strip(), (a.get('locality') or '').strip().title(),
        (a.get('postcode') or '')[:5], round(r.get('confidence') or 0, 2), 1 if (r.get('brand') or {}).get('wikidata') else 0,
    ]


def sort_places(rows):
    """Places into the page's groups, without duplicates, plus every usable place's position by
    city and by ZIP code (for the place box's centers)."""
    tax_group = {t: g for g, ts in GROUPS.items() for t in ts}
    out = {g: [] for g in GROUPS}
    seen = set()
    localities, zips = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        if not usable(r):
            continue
        row = place_row(r)
        lon, lat = r['bbox']['xmin'], r['bbox']['ymin']  # unrounded, for the centers and the key
        city, zipc = row[10], row[11]
        if city and city != 'Los Angeles':  # "Los Angeles" covers most of the Valley: too broad to search from
            localities[city].append((lat, lon))
        if re.fullmatch(r'\d{5}', zipc):
            zips[zipc].append((lat, lon))
        g = tax_group.get(row[4])
        if not g or not row[1]:
            continue
        key = dedupe_key(row[1], row[5], lat, lon)
        if key in seen:
            continue
        seen.add(key)
        out[g].append(row)
    return out, localities, zips


def centers(points, min_n):
    """[name, lat, lon, count] for each place with at least min_n points, biggest first. The center
    is the median, so a few mislabeled addresses across town don't drag it away."""
    res = []
    for k, pts in points.items():
        if len(pts) < min_n:
            continue
        res.append([k, round(statistics.median(p[0] for p in pts), 4), round(statistics.median(p[1] for p in pts), 4), len(pts)])
    return sorted(res, key=lambda x: -x[3])


def compact(items):
    """A group's rows, sorted by position, with each category stored once: { fields, types, rows }."""
    items = sorted(items, key=lambda x: (x[2], x[3]))
    types = sorted({x[4] for x in items})
    ti = {t: i for i, t in enumerate(types)}
    return {'fields': FIELDS, 'types': types, 'rows': [x[:4] + [ti[x[4]]] + x[5:] for x in items]}


# ---------------------------------------------------------------- the whole list

def main():
    release = latest_release()
    print('Overture release', release, flush=True)
    rows = read_area(release)
    print('places in the box:', len(rows), flush=True)
    out, localities, zips = sort_places(rows)

    os.makedirs(OUT, exist_ok=True)
    counts = {}
    for g, items in out.items():
        with open(os.path.join(OUT, f'{g}.json'), 'w') as f:
            json.dump(compact(items), f, separators=(',', ':'), ensure_ascii=False)
        counts[g] = len(items)
        print(f'{g}: {len(items)}', flush=True)

    meta = {
        'source': 'Overture Maps Foundation, places theme',
        'license': 'CDLA-Permissive-2.0 (includes data from Meta, Microsoft, Foursquare and others)',
        'attribution': 'https://docs.overturemaps.org/attribution/',
        'release': release, 'built': date.today().isoformat(), 'coverage': COVERAGE,
        'box': [WEST, SOUTH, EAST, NORTH], 'counts': counts,
        'areas': centers(localities, 25), 'zips': centers(zips, 25),
    }
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)
    print('areas:', len(meta['areas']), 'zips:', len(meta['zips']))


if __name__ == '__main__':
    main()
