#!/usr/bin/env python3
"""Export the store's catalog through the Shopify Admin GraphQL API.

Writes catalog/catalog.json (the shape tools/rmc_audit.py reads) and
catalog/products.csv (one row per variant, for spreadsheets).

    export SHOPIFY_STORE=your-store.myshopify.com
    export SHOPIFY_ADMIN_TOKEN=shpat_...        # custom app with read_products
    python3 tools/export_catalog.py

    python3 tools/export_catalog.py --csv-only  # rebuild the CSV from catalog.json
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG_JSON = ROOT / "catalog" / "catalog.json"
CATALOG_CSV = ROOT / "catalog" / "products.csv"
API_VERSION = "2025-07"

QUERY = """
query Catalog($after: String) {
  products(first: 25, after: $after, sortKey: CREATED_AT) {
    nodes {
      title handle productType vendor tags status
      options { name values }
      seo { title description }
      media(first: 10) { nodes { alt mediaContentType } }
      variants(first: 100) {
        nodes { title sku price compareAtPrice inventoryQuantity barcode selectedOptions { name value } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

CSV_COLUMNS = ["handle", "title", "product_type", "status", "tags", "variant", "sku",
               "price", "compare_at_price", "inventory"]


def graphql(store: str, token: str, query: str, variables: dict) -> dict:
    request = urllib.request.Request(
        f"https://{store}/admin/api/{API_VERSION}/graphql.json",
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise RuntimeError(f"Shopify returned errors: {payload['errors']}")
    return payload["data"]


def fetch_products(store: str, token: str) -> list[dict]:
    products, after = [], None
    while True:
        page = graphql(store, token, QUERY, {"after": after})["products"]
        products.extend(page["nodes"])
        if not page["pageInfo"]["hasNextPage"]:
            return products
        after = page["pageInfo"]["endCursor"]


def csv_rows(products: list[dict]):
    for product in products:
        for variant in product["variants"]["nodes"]:
            yield {
                "handle": product["handle"],
                "title": product["title"],
                "product_type": product["productType"],
                "status": product["status"],
                "tags": ", ".join(product["tags"]),
                "variant": variant["title"],
                "sku": variant["sku"],
                "price": variant["price"],
                "compare_at_price": variant["compareAtPrice"] or "",
                "inventory": variant["inventoryQuantity"],
            }


def write_csv(products: list[dict], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(csv_rows(products))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv-only", action="store_true", help="rebuild products.csv from catalog.json")
    args = parser.parse_args(argv)

    if args.csv_only:
        products = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))["data"]["products"]["nodes"]
    else:
        store, token = os.environ.get("SHOPIFY_STORE"), os.environ.get("SHOPIFY_ADMIN_TOKEN")
        if not store or not token:
            print("Set SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN (see the docstring).", file=sys.stderr)
            return 2
        products = fetch_products(store, token)
        envelope = {"data": {"products": {"nodes": products, "pageInfo": {"hasNextPage": False}}}}
        CATALOG_JSON.write_text(json.dumps(envelope, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    write_csv(products, CATALOG_CSV)
    variants = sum(len(p["variants"]["nodes"]) for p in products)
    print(f"{len(products)} products, {variants} variants -> {CATALOG_CSV.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
