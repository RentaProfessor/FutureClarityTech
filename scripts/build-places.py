#!/usr/bin/env python3
"""Build the Lead Finder's business list from Overture Maps open data.

Writes public/data/places/*.json: one compact file per kind of business, covering the
San Fernando Valley and nearby areas, plus meta.json (release, counts, and a list of
neighborhoods, cities and ZIP codes with their map centers for the place box).

The page reads these files from our own site, so a search needs no outside server,
no key and no account. Re-run this to pick up Overture's latest monthly release:

    pip install pyarrow fsspec aiohttp
    python scripts/build-places.py

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

import fsspec
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

BUCKET = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'places')

# The Valley plus Calabasas/Agoura, Burbank, Glendale, the Hollywood Hills and west Pasadena.
WEST, SOUTH, EAST, NORTH = -118.80, 34.08, -118.15, 34.36
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
    # "Something else": other appointment and walk-in businesses we could build for.
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
SOCIAL = re.compile(r'facebook\.com|instagram\.com|yelp\.com|linktr\.ee|tiktok\.com|twitter\.com|x\.com', re.I)


def latest_release():
    url = BUCKET + '?list-type=2&prefix=release/&delimiter=/'
    xml = fetch(url)
    rels = sorted(re.findall(r'<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>', xml))
    if not rels:
        sys.exit('No Overture releases found')
    return rels[-1]


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode()


def place_files(release):
    xml = fetch(BUCKET + f'?list-type=2&prefix=release/{release}/theme=places/type=place/')
    return [BUCKET + k for k in re.findall(r'<Key>([^<]+\.parquet)</Key>', xml)]


def phone(v):
    d = re.sub(r'\D', '', v or '')
    if len(d) == 11 and d.startswith('1'):
        d = d[1:]
    return f'({d[:3]}) {d[3:6]}-{d[6:]}' if len(d) == 10 else (v or '').strip()


def first(xs, test=lambda x: True):
    for x in xs or []:
        if x and test(x):
            return x
    return ''


def main():
    release = latest_release()
    print('Overture release', release, flush=True)
    fs = fsspec.filesystem('https', client_kwargs={'trust_env': True}, block_size=8 * 2**20)
    tables = []
    for url in place_files(release):
        with fs.open(url, 'rb') as f:
            pf = pq.ParquetFile(f)
            md = pf.metadata
            idx = {md.schema.column(i).path: i for i in range(md.num_columns)}
            groups = []
            for g in range(md.num_row_groups):
                rg = md.row_group(g)
                s = lambda c: rg.column(idx[c]).statistics
                if s('bbox.xmax').max < WEST or s('bbox.xmin').min > EAST or s('bbox.ymax').max < SOUTH or s('bbox.ymin').min > NORTH:
                    continue
                groups.append(g)
            for i in range(0, len(groups), 8):
                t = pf.read_row_groups(groups[i:i + 8], columns=COLS)
                b = t.column('bbox')
                x, y = pc.struct_field(b, 'xmin'), pc.struct_field(b, 'ymin')
                keep = pc.and_(pc.and_(pc.greater_equal(x, WEST), pc.less_equal(x, EAST)), pc.and_(pc.greater_equal(y, SOUTH), pc.less_equal(y, NORTH)))
                tables.append(t.filter(keep))
            if groups:
                print(f'  {url[-70:-44]}: {len(groups)} row groups', flush=True)
    rows = pa.concat_tables(tables).to_pylist()
    print('places in the box:', len(rows), flush=True)

    tax_group = {t: g for g, ts in GROUPS.items() for t in ts}
    out = {g: [] for g in GROUPS}
    seen = set()
    localities, zips = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        if (r.get('operating_status') or 'open') != 'open' or (r.get('confidence') or 0) < MIN_CONFIDENCE:
            continue
        name = ((r.get('names') or {}).get('primary') or '').strip()
        lon, lat = r['bbox']['xmin'], r['bbox']['ymin']
        a = (r.get('addresses') or [{}])[0] or {}
        city = (a.get('locality') or '').strip().title()
        zipc = (a.get('postcode') or '')[:5]
        if city and city != 'Los Angeles':
            localities[city].append((lat, lon))
        if re.fullmatch(r'\d{5}', zipc):
            zips[zipc].append((lat, lon))
        tax = ((r.get('taxonomy') or {}).get('primary') or '')
        g = tax_group.get(tax)
        if not g or not name:
            continue
        tel = phone(first(r.get('phones')))
        key = (re.sub(r'[^a-z0-9]', '', name.lower()), re.sub(r'\D', '', tel)[-10:] or f'{lat:.4f},{lon:.4f}')
        if key in seen:
            continue
        seen.add(key)
        web = first(r.get('websites'), lambda u: not SOCIAL.search(u)) or first(r.get('websites'))
        social = first(r.get('socials'), lambda u: re.search(r'facebook\.com|instagram\.com', u, re.I)) or first(r.get('socials'))
        out[g].append([
            r['id'][:16], name, round(lat, 5), round(lon, 5), tax, tel, web, (first(r.get('emails')) or '').lower(), social,
            (a.get('freeform') or '').strip(), city, zipc, round(r.get('confidence') or 0, 2), 1 if (r.get('brand') or {}).get('wikidata') else 0,
        ])

    os.makedirs(OUT, exist_ok=True)
    fields = ['id', 'name', 'lat', 'lon', 'type', 'phone', 'website', 'email', 'social', 'street', 'city', 'zip', 'confidence', 'chain']
    counts = {}
    for g, items in out.items():
        items.sort(key=lambda x: (x[2], x[3]))
        types = sorted({x[4] for x in items})
        ti = {t: i for i, t in enumerate(types)}
        for x in items:
            x[4] = ti[x[4]]
        with open(os.path.join(OUT, f'{g}.json'), 'w') as f:
            json.dump({'fields': fields, 'types': types, 'rows': items}, f, separators=(',', ':'), ensure_ascii=False)
        counts[g] = len(items)
        print(f'{g}: {len(items)}', flush=True)

    def centers(d, min_n):
        res = []
        for k, pts in d.items():
            if len(pts) < min_n:
                continue
            lats, lons = [p[0] for p in pts], [p[1] for p in pts]
            res.append([k, round(statistics.median(lats), 4), round(statistics.median(lons), 4), len(pts)])
        return sorted(res, key=lambda x: -x[3])
    meta = {
        'source': 'Overture Maps Foundation, places theme',
        'license': 'CDLA-Permissive-2.0 (includes data from Meta, Microsoft, Foursquare and others)',
        'attribution': 'https://docs.overturemaps.org/attribution/',
        'release': release, 'built': date.today().isoformat(),
        'box': [WEST, SOUTH, EAST, NORTH], 'counts': counts,
        'areas': centers(localities, 25), 'zips': centers(zips, 25),
    }
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'), ensure_ascii=False)
    print('areas:', len(meta['areas']), 'zips:', len(meta['zips']))


if __name__ == '__main__':
    main()
