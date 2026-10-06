# Collections and navigation

Twelve of the fourteen storefront collections are **automated**: Shopify adds and removes
products based on rules over product type, tags and inventory, so publishing a correctly
tagged product puts it everywhere it belongs with no manual curation. Only the lookbook
(hand-sequenced on purpose) and the archive are manual.

| Collection | Rule | Sort |
|---|---|---|
| Available Now | any variant inventory > 0 | best selling |
| New Arrivals | tag `drop:01` | newest first |
| Hats | type = Hats **or** Beanies | best selling |
| Truckers | type = Hats **and** title doesn't contain "Kids" | best selling |
| Beanies | type = Beanies | best selling |
| Bags | type = Bags | best selling |
| Apparel | type = T-Shirts, Sweatshirts, Outerwear, Bottoms **or** Swimwear | best selling |
| Fleece | type = Sweatshirts | best selling |
| Bottoms & Swim | type = Bottoms **or** Swimwear | best selling |
| Accessories | type = Accessories | best selling |
| Kids | tag `dept:kids` | best selling |
| Sale | tag `pgm:sale-2026-12-31` | best selling |
| Drop 01 Lookbook | manual: six hero products, hats to hems | manual |
| Archive | manual: sold-out styles kept for reference | newest first |

Notes on the rules:

- **Truckers** excludes kids' hats by title because Shopify's automated collections can only
  match tags with "is equal to", not "is not equal to". The Kids Trucker also has its own SKU
  category (`KID`), so the title rule and the SKU agree.
- **Sale** keys on the program tag, and the tag carries the program's end date. When a markdown
  ends, the audit fails until the compare-at prices come off, which keeps the Sale collection and
  the prices from drifting apart.
- **New Arrivals** follows the drop number, so launching Drop 02 is a tag change, not a
  re-curation.

## Navigation

```
Main menu                          Footer
├── Shop All      → Available Now  ├── Size Guide
├── New           → New Arrivals   ├── Shipping & Returns
├── Hats                           ├── About
│   ├── Truckers                   └── Search
│   ├── Beanies
│   └── Kids
├── Bags
├── Apparel
│   ├── Fleece
│   └── Bottoms & Swim
├── Accessories
├── Lookbook      → Drop 01 Lookbook
└── Sale
```

"Shop All" points at **Available Now** rather than the full catalog, so the first grid a shopper
sees never leads with sold-out product.
