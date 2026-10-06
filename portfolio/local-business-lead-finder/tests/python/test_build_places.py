"""scripts/build-places.py, without the network: one place at a time, the whole sort, and reading
only the row groups of a Parquet file that overlap the area."""
import importlib.util
import pathlib

import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'build-places.py'
spec = importlib.util.spec_from_file_location('build_places', SCRIPT)
bp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bp)

BOX = (-118.80, 34.08, -118.15, 34.36)  # west, south, east, north


def place(**kw):
    """An Overture place, as pyarrow's to_pylist() gives it (all fictional)."""
    lon, lat = kw.pop('at', (-118.4514, 34.1899))
    p = {
        'id': '08f2a1b2c3d4e5f60123456789abcdef',
        'names': {'primary': 'Copperline Auto Care'},
        'taxonomy': {'primary': 'automotive_repair'},
        'confidence': 0.9,
        'websites': ['https://www.facebook.com/copperline.demo', 'http://copperlineautocare.test/'],
        'phones': ['+18185550100'],
        'emails': ['Info@CopperlineAutoCare.test'],
        'socials': ['https://twitter.com/copperline_demo', 'https://www.instagram.com/copperline.demo'],
        'brand': None,
        'addresses': [{'freeform': '14098 Walnut Ave', 'locality': 'VAN NUYS', 'postcode': '91401-1234'}],
        'operating_status': 'open',
        'bbox': {'xmin': lon, 'ymin': lat, 'xmax': lon + 0.0001, 'ymax': lat + 0.0001},
    }
    p.update(kw)
    return p


@pytest.mark.parametrize('raw, want', [
    ('+18185550100', '(818) 555-0100'),
    ('818.555.0100', '(818) 555-0100'),
    ('(818) 555-0100 ext 2', '(818) 555-0100 ext 2'),  # not just a number: left as it was
    ('', ''),
    (None, ''),
])
def test_phone(raw, want):
    assert bp.phone(raw) == want


def test_place_row():
    row = bp.place_row(place())
    assert dict(zip(bp.FIELDS, row)) == {
        'id': '08f2a1b2c3d4e5f6', 'name': 'Copperline Auto Care', 'lat': 34.1899, 'lon': -118.4514, 'type': 'automotive_repair',
        'phone': '(818) 555-0100',
        'website': 'http://copperlineautocare.test/',  # its own site, not the Facebook page listed first
        'email': 'info@copperlineautocare.test',
        'social': 'https://www.instagram.com/copperline.demo',  # Instagram or Facebook before other socials
        'street': '14098 Walnut Ave', 'city': 'Van Nuys', 'zip': '91401', 'confidence': 0.9, 'chain': 0,
    }
    assert bp.place_row(place(brand={'wikidata': 'Q0000000'}))[-1] == 1  # a brand: a chain
    assert bp.place_row(place(websites=['https://www.facebook.com/x'], socials=None))[6] == 'https://www.facebook.com/x'


def test_usable():
    assert bp.usable(place())
    assert bp.usable(place(operating_status=None))
    assert not bp.usable(place(operating_status='permanently_closed'))
    assert not bp.usable(place(confidence=0.2))


def test_dedupe_key():
    a = bp.dedupe_key('Copperline Auto Care', '(818) 555-0100', 34.1899, -118.4514)
    assert a == bp.dedupe_key("COPPERLINE AUTO-CARE", '818-555-0100', 34.2, -118.5)
    assert bp.dedupe_key('Copperline Auto Care', '', 34.18994, -118.45141) == ('copperlineautocare', '34.1899,-118.4514')


def test_sort_places():
    rows = [
        place(),
        place(id='dup' * 6, names={'primary': 'Copperline Auto-Care'}, phones=['818-555-0100']),  # the same shop twice
        place(id='closed' * 3, names={'primary': 'Bluebird Garage'}, operating_status='closed'),
        place(id='nail' * 4, names={'primary': 'Lotus Pond Nails'}, taxonomy={'primary': 'nail_salon'}, phones=['+17475550111']),
        place(id='bank' * 4, names={'primary': 'A Bank'}, taxonomy={'primary': 'bank'}, addresses=[{'locality': 'Encino', 'postcode': '91436'}]),
        place(id='la' * 8, names={'primary': 'Ridgeway Motor Works'}, phones=[], addresses=[{'locality': 'los angeles', 'postcode': '91405'}]),
    ]
    out, localities, zips = bp.sort_places(rows)
    assert [r[1] for r in out['auto']] == ['Copperline Auto Care', 'Ridgeway Motor Works']
    assert [r[1] for r in out['other']] == ['Lotus Pond Nails']
    # every usable place counts toward the place box's centers, even one that isn't listed;
    # "Los Angeles" is too broad to search from
    assert sorted(localities) == ['Encino', 'Van Nuys']
    assert sorted(zips) == ['91401', '91405', '91436']


def test_centers_use_the_median():
    pts = {'Van Nuys': [(34.18, -118.45), (34.19, -118.45), (34.20, -118.46), (35.9, -120.0)],  # one address across the state
           'Tiny': [(34.1, -118.4)]}
    assert bp.centers(pts, 2) == [['Van Nuys', 34.195, -118.455, 4]]
    assert [c[0] for c in bp.centers(pts, 1)] == ['Van Nuys', 'Tiny']


def test_compact():
    rows = [bp.place_row(place(at=(-118.40, 34.20), names={'primary': 'B'}, taxonomy={'primary': 'tire_shop'})),
            bp.place_row(place(at=(-118.45, 34.10), names={'primary': 'A'})),
            bp.place_row(place(at=(-118.41, 34.15), names={'primary': 'C'}, taxonomy={'primary': 'tire_shop'}))]
    c = bp.compact(rows)
    assert c['fields'] == bp.FIELDS
    assert c['types'] == ['automotive_repair', 'tire_shop']
    assert [(r[1], r[4]) for r in c['rows']] == [('A', 0), ('C', 1), ('B', 1)]  # south to north, types by index


# ---------------------------------------------------------------- Parquet (needs pyarrow)

def bbox_table(points):
    pa = pytest.importorskip('pyarrow')
    return pa.table({
        'id': [f'p{i}' for i in range(len(points))],
        'bbox': [{'xmin': x, 'ymin': y, 'xmax': x + 0.001, 'ymax': y + 0.001} for x, y in points],
    })


def test_overlapping_row_groups(tmp_path):
    pq = pytest.importorskip('pyarrow.parquet')
    points = [
        (-118.45, 34.19), (-118.40, 34.20),  # 0: inside the box
        (-119.60, 34.20), (-119.50, 34.25),  # 1: west of it
        (-118.40, 35.10), (-118.30, 35.20),  # 2: north of it
        (-118.79, 34.10), (-118.95, 34.10),  # 3: across its west edge
    ]
    path = tmp_path / 'places.parquet'
    pq.write_table(bbox_table(points), path, row_group_size=2)
    meta = pq.ParquetFile(path).metadata
    assert meta.num_row_groups == 4
    assert bp.overlapping_row_groups(meta, BOX) == [0, 3]


def test_in_box():
    table = bbox_table([(-118.45, 34.19), (-119.60, 34.20), (-118.79, 34.10), (-118.95, 34.10)])
    assert bp.in_box(table, BOX).column('id').to_pylist() == ['p0', 'p2']
