# Theme configuration

The storefront runs on Shopify's [Horizon](https://github.com/Shopify/horizon) theme, version
4.1.4, **configured rather than forked**. Every Liquid, CSS and JavaScript file is Shopify's
code, unchanged. The brand lives entirely in the three JSON files in this folder, which is how
Horizon is meant to be customized: sections and blocks are composed in JSON, and the theme
renders them.

| File | What it sets |
|---|---|
| [`config/settings_data.json`](config/settings_data.json) | Logo, the black-on-white palette (`#111111` on `#FFFFFF`), Archivo Black for headings, Work Sans for body text, the slide-out cart drawer, and prices without a trailing currency code (the cart total keeps it) |
| [`sections/header-group.json`](sections/header-group.json) | The announcement bar ("FREE U.S. SHIPPING OVER $85 · 60-DAY RETURNS — HATS INCLUDED"), uppercase navigation, left-aligned logo, hairline dividers, country and language selectors off |
| [`templates/index.json`](templates/index.json) | The home page, top to bottom: a "DROP 01 — OUT NOW" hero linking to the lookbook, a black marquee with the store's promises, New Arrivals, Shop by Category tiles (truckers, bags, apparel, accessories), and the six-product Drop 01 lookbook |

The home page is assembled from the same collections the catalog's tags maintain, so it stays
current without edits: New Arrivals follows `drop:01`, and the lookbook is the hand-sequenced
Drop 01 collection.

## Applying it

These files go on top of a stock Horizon 4.1.4 theme. With the
[Shopify CLI](https://shopify.dev/docs/storefronts/themes/tools/cli):

```sh
git clone https://github.com/Shopify/horizon.git && cd horizon
git checkout f63ddf8                       # "Horizon v4.1.4"
cp -r ../redline-shopify-store/theme/{config,sections,templates} .
shopify theme push --unpublished --store your-store.myshopify.com
```

The logo, hero image and collections are referenced by handle (`shopify://shop_images/...`,
`shopify://collections/...`), so they resolve against the store's own files and collections.

Horizon itself isn't redistributed here: its license allows building on it for Shopify stores
but not republishing the theme.
