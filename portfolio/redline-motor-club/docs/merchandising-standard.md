# Merchandising standard

Every product in the store follows the rules below. They are written down once in
[`standards/standards.json`](../standards/standards.json) and enforced by
[`tools/rmc_audit.py`](../tools/rmc_audit.py), so a new product that breaks them fails the audit
before it is published.

## SKUs

```
RMC - HAT - MSH - CHY - OS
 │     │     │     │    └─ size      OS for one-size; SM/MD/LG...; waist in inches for denim
 │     │     │     └────── color     three-letter code, one per color name, shared across products
 │     │     └──────────── style     three letters, unique within the category
 │     └────────────────── category  maps to exactly one product type
 └──────────────────────── brand
```

One product = one style. Colorways and sizes are **variants** of that product, never separate
listings, so reviews, inventory and the color picker stay in one place. 24 products carry 177
variants, and every SKU is unique.

| Category | Product type | Styles |
|---|---|---|
| `HAT` | Hats | `MSH` Classic Mesh, `FOM` Foam Front, `SUE` Suede Panel, `VEL` Velour, `RHN` Rhinestone Halo |
| `KID` | Hats | `MSH` Kids Mesh Trucker |
| `BEA` | Beanies | `RIB` Ribbed Cuff Beanie |
| `BAG` | Bags | `BWL` Bowling, `MBW` Mini Bowling, `SHD` Shoulder, `SLG` Crossbody Sling, `DUF` Weekender Duffle |
| `TEE` | T-Shirts | `GRP` Heavyweight Graphic Tee, `BBY` Baby Tee |
| `TNK` | T-Shirts | `RIB` Ribbed Tank |
| `HOD` | Sweatshirts | `HVY` Heavyweight Hoodie |
| `JKT` | Outerwear | `TRK` Zip Track Jacket |
| `SHT` | Outerwear | `MEC` Mechanic Shirt |
| `JEA` | Bottoms | `STR` Straight-Leg Jean |
| `SWM` | Swimwear | `BRD` Board Swim Short |
| `WAL` `KEY` `SUN` `SOK` | Accessories | `ZIP` Wallet, `HAL` Keychain, `REC` Sunglasses, `CRW` Crew Socks |

| Color | Code | Color | Code |
|---|---|---|---|
| Black | `BLK` | Sky Blue | `SKY` |
| White | `WHT` | Navy | `NVY` |
| Bone | `BON` | Indigo Wash | `IND` |
| Cherry Red | `CHY` | Moss Green | `MOS` |
| Hot Pink | `HPK` | Sunburst Yellow | `SUN` |
| Baby Pink | `BPK` | Chrome Silver | `CHR` |
| Cheetah | `CHT` | Desert Camo | `CAM` |

Sizes: `XS SM MD LG XL 2XL 3XL`, waist `28`–`38` for denim, `OS` for one-size. The Board Swim
Short's extended run is coded `1X 2X 3X`; the audit flags it because every other style uses
`2XL 3XL`, and one catalog should use one convention.

## Tags

Tags are namespaced so collections and filters can be built from them without guesswork.
Each product carries exactly one of each required namespace.

| Namespace | Required | Values | Used by |
|---|---|---|---|
| `dept:` | yes | `unisex` `womens` `mens` `kids` | Kids collection |
| `drop:` | yes | two digits: `00` carryover, `01` current drop | New Arrivals collection |
| `fit:` | yes | `regular` `oversized` `cropped` `relaxed` `slim` | fit notes, size guide |
| `mat:` | yes | kebab-case material, e.g. `mesh-twill`, `fleece-400gsm` | storefront filters |
| `pgm:` | no | `sale-YYYY-MM-DD`, the last day of a markdown program | Sale collection |

## Pricing

A markdown is a **program with an end date**, not a one-off edit. A product is on sale only when
it carries `pgm:sale-YYYY-MM-DD`, and then every variant must have a compare-at price above its
selling price. Compare-at prices without the tag, or after the end date, fail the audit.

## Content

- At least two images per product, every image with alt text, and the featured image's alt text
  names the product.
- A custom SEO title (under 60 characters) and meta description (under 160) on every product.
- The full color × size matrix exists for every apparel style, with sizes in scale order.
- Real garment measurements on the [Size Guide](https://eepcnb-0u.myshopify.com/pages/size-guide),
  in inches and centimeters.
