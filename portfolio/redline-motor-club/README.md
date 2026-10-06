# Redline Motor Club

A concept streetwear brand I built end to end on Shopify to show how I run e-commerce
merchandising: a catalog designed around one written SKU standard, collections that maintain
themselves from tags and inventory, a storefront configured on Shopify's Horizon theme, and a
Python tool that audits the whole catalog against the standard before anything goes live.

**Live store: [eepcnb-0u.myshopify.com](https://eepcnb-0u.myshopify.com)**. It's a concept
store; nothing is for sale and all imagery is AI-generated.

| | |
|---|---|
| Catalog | 24 styles across 9 product types, 177 variants, $14–$149 |
| SKUs | 177, all unique, all on one pattern: `RMC-HAT-MSH-CHY-OS` |
| Collections | 12 automated from type, tag and inventory rules, plus a hand-sequenced lookbook |
| Content | 88 product images with alt text, custom SEO on every product, real garment measurements |
| Theme | Shopify Horizon 4.1.4, configured for the brand ([`theme/`](theme/)) |
| Tooling | Catalog export and audit in dependency-free Python, 26 unit tests, CI |

## What's in the store

**One product per style, variants for everything else.** Every colorway and size is a variant
of a single product, never a separate listing, so the color picker, inventory and reviews stay
together. The Heavyweight Graphic Tee is one product with 20 variants (4 colors × 5 sizes),
not 20 listings.

**A SKU standard you can read.** `RMC-HAT-MSH-CHY-OS` is brand, category, style, color, size.
Category codes map to exactly one product type, color codes are shared across the catalog
(`CHY` is Cherry Red on a trucker and on a bowling bag), and one-size goods use `OS`. The full
code tables are in [docs/merchandising-standard.md](docs/merchandising-standard.md).

**Namespaced tags that drive the storefront.** Each product carries exactly one `dept:`,
`drop:`, `fit:` and `mat:` tag, plus `pgm:sale-YYYY-MM-DD` when it's in a markdown. New
Arrivals follows `drop:01`, Kids follows `dept:kids`, and Sale follows the program tag, so
publishing a correctly tagged product puts it in every collection it belongs in.

**Collections that maintain themselves.** "Shop All" is the *Available Now* collection
(any variant in stock), so the first grid a shopper sees never leads with sold-out product.
The rules for all 14 collections and the menu structure are in
[docs/collections-and-navigation.md](docs/collections-and-navigation.md).

**Customer-facing standards.** A [Size Guide](https://eepcnb-0u.myshopify.com/pages/size-guide)
with flat garment measurements in inches and centimeters (unisex tops, women's cuts, denim,
headwear), fit notes per cut (oversized, cropped, regular), and a
[Shipping & Returns](https://eepcnb-0u.myshopify.com/pages/shipping-returns) policy written the
way a shopper reads it.

**A storefront configured, not forked.** The theme is Shopify's Horizon 4.1.4 with the brand
expressed entirely through its JSON configuration: palette, type (Archivo Black over Work
Sans), the announcement bar, and a home page that runs hero → marquee → New Arrivals → Shop by
Category → Drop 01 lookbook. Because the home page is built from the tag-driven collections,
launching the next drop changes the storefront without touching the theme. The three
configuration files and how to apply them are in [`theme/`](theme/).

## Catalog audit

[`tools/rmc_audit.py`](tools/rmc_audit.py) checks every product against
[`standards/standards.json`](standards/standards.json): SKU structure and code tables, SKU ↔
variant option agreement, unique SKUs and styles, required tag namespaces and allowed values,
markdown programs and compare-at pricing, size scale order, gaps in the color × size matrix,
image count and alt text, SEO lengths, and one extended-size convention per catalog. It exits
non-zero on errors, so it can gate a launch, and it also prints an out-of-stock and low-stock
report.

```text
$ python3 tools/rmc_audit.py
Redline Motor Club catalog audit: 24 products, 177 variants, as of 2026-10-06

ERRORS (0)

WARNINGS (1)
  ! Board Swim Short [sizes] uses 1X/2X/3X while 3 other products use 2XL/3XL

INVENTORY: 6 out of stock, 15 below 5
  out    0  Foam Front Trucker / Sunburst Yellow  RMC-HAT-FOM-SUN-OS
  ...
```

It has already paid for itself. The first run caught a markdown program that had ended on
September 30 while four products still showed sale prices, and a wallet whose featured image
was a group flat lay. Both were fixed in the store: the program now runs through December 31,
and on January 1 the audit will flag those compare-at prices again until they come off.

```sh
python3 tools/export_catalog.py          # pull the catalog (needs SHOPIFY_STORE + SHOPIFY_ADMIN_TOKEN)
python3 tools/rmc_audit.py               # audit it as of today
python3 -m unittest discover -s tools/tests
```

## Repository layout

```
standards/standards.json   the standard, as data: code tables, tag rules, thresholds
tools/rmc_audit.py         audits a catalog export against the standard
tools/export_catalog.py    exports the catalog through the Admin GraphQL API (JSON + CSV)
tools/tests/               unit tests, including the real catalog
catalog/                   the exported catalog: catalog.json and products.csv
docs/                      the merchandising standard, collection rules and navigation
theme/                     the storefront's configuration on top of Shopify Horizon 4.1.4
```
