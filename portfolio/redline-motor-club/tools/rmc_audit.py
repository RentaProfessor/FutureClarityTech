#!/usr/bin/env python3
"""Audit a Shopify catalog export against the Redline Motor Club merchandising standard.

The standard lives in standards/standards.json: SKU code tables, the tag
taxonomy, and media/SEO/inventory thresholds. The catalog is the JSON that
tools/export_catalog.py writes (the raw Admin GraphQL `products` response).

    python3 tools/rmc_audit.py                      # audit catalog/catalog.json
    python3 tools/rmc_audit.py --today 2026-09-01   # audit as of a given date
    python3 tools/rmc_audit.py --json               # machine-readable output

Exits 1 when any error is found, so it can gate CI or a pre-publish check.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STANDARDS = ROOT / "standards" / "standards.json"
DEFAULT_CATALOG = ROOT / "catalog" / "catalog.json"

ERROR = "error"
WARNING = "warning"


@dataclass(frozen=True)
class Finding:
    level: str
    product: str
    rule: str
    message: str


def load_products(path: Path) -> list[dict]:
    """Accept either the raw GraphQL response or a bare list of products."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    return data["data"]["products"]["nodes"]


def variants_of(product: dict) -> list[dict]:
    return product["variants"]["nodes"]


def option_value(variant: dict, name: str) -> str | None:
    for option in variant.get("selectedOptions", []):
        if option["name"] == name:
            return option["value"]
    return None


def split_tags(product: dict) -> dict[str, list[str]]:
    """Group `namespace:value` tags by namespace; bare tags go under ''."""
    grouped: dict[str, list[str]] = defaultdict(list)
    for tag in product.get("tags", []):
        namespace, sep, value = tag.partition(":")
        if sep:
            grouped[namespace].append(value)
        else:
            grouped[""].append(tag)
    return grouped


def money(amount: str | None) -> float | None:
    return float(amount) if amount not in (None, "") else None


class Auditor:
    def __init__(self, standards: dict, today: dt.date):
        self.std = standards
        self.today = today
        self.findings: list[Finding] = []

    def flag(self, level: str, product: dict | str, rule: str, message: str) -> None:
        title = product if isinstance(product, str) else product["title"]
        self.findings.append(Finding(level, title, rule, message))

    def run(self, products: list[dict]) -> list[Finding]:
        for product in products:
            self.check_skus(product)
            self.check_tags(product)
            self.check_pricing(product)
            self.check_options(product)
            self.check_media(product)
            self.check_seo(product)
        self.check_catalog(products)
        return self.findings

    # --- SKUs -------------------------------------------------------------

    def check_skus(self, product: dict) -> None:
        std = self.std
        styles = set()
        for variant in variants_of(product):
            sku = variant.get("sku") or ""
            label = f"{variant['title']} ({sku or 'no SKU'})"
            parts = sku.split("-")
            if len(parts) != 5:
                self.flag(ERROR, product, "sku", f"{label}: expected {std['sku_pattern']}")
                continue
            brand, category, style, color, size = parts
            styles.add((category, style))

            if brand != std["brand_prefix"]:
                self.flag(ERROR, product, "sku", f"{label}: brand prefix should be {std['brand_prefix']}")
            if category not in std["categories"]:
                self.flag(ERROR, product, "sku", f"{label}: unknown category code {category}")
            elif std["categories"][category] != product["productType"]:
                self.flag(ERROR, product, "sku",
                          f"{label}: category {category} is for {std['categories'][category]}, "
                          f"but the product type is {product['productType']}")
            if not re.fullmatch(r"[A-Z]{3}", style):
                self.flag(ERROR, product, "sku", f"{label}: style code must be three letters")

            color_name = option_value(variant, "Color")
            if color not in std["colors"]:
                self.flag(ERROR, product, "sku", f"{label}: unknown color code {color}")
            elif color_name is not None and std["colors"][color] != color_name:
                self.flag(ERROR, product, "sku",
                          f"{label}: color code {color} is {std['colors'][color]}, variant says {color_name}")

            size_name = option_value(variant, "Size")
            if size not in std["sizes"]:
                self.flag(ERROR, product, "sku", f"{label}: unknown size code {size}")
            elif size_name is None and size != "OS":
                self.flag(ERROR, product, "sku", f"{label}: one-size products use size code OS")
            elif size_name is not None and std["sizes"][size] != size_name:
                self.flag(ERROR, product, "sku",
                          f"{label}: size code {size} is {std['sizes'][size]}, variant says {size_name}")

        if len(styles) > 1:
            codes = ", ".join(f"{c}-{s}" for c, s in sorted(styles))
            self.flag(ERROR, product, "sku", f"variants disagree on category/style: {codes}")

    # --- Tags -------------------------------------------------------------

    def check_tags(self, product: dict) -> None:
        rules = self.std["tags"]
        tags = split_tags(product)
        for namespace in rules["required"]:
            values = tags.get(namespace, [])
            if len(values) != 1:
                found = "missing" if not values else f"found {len(values)}"
                self.flag(ERROR, product, "tags", f"needs exactly one {namespace}: tag ({found})")
        for namespace, values in tags.items():
            if namespace == "":
                self.flag(WARNING, product, "tags", f"tags without a namespace: {', '.join(values)}")
                continue
            if namespace not in rules["required"] and namespace not in rules["patterns"]:
                self.flag(WARNING, product, "tags", f"unknown tag namespace {namespace}:")
                continue
            allowed = rules["allowed"].get(namespace)
            pattern = rules["patterns"].get(namespace)
            for value in values:
                if allowed and value not in allowed:
                    self.flag(ERROR, product, "tags", f"{namespace}:{value} is not one of {', '.join(allowed)}")
                if pattern and not re.fullmatch(pattern, value):
                    self.flag(ERROR, product, "tags", f"{namespace}:{value} does not match {pattern}")

    # --- Pricing ----------------------------------------------------------

    def sale_end(self, product: dict) -> dt.date | None:
        for value in split_tags(product).get("pgm", []):
            match = re.fullmatch(r"sale-(\d{4}-\d{2}-\d{2})", value)
            if match:
                return dt.date.fromisoformat(match.group(1))
        return None

    def check_pricing(self, product: dict) -> None:
        end = self.sale_end(product)
        variants = variants_of(product)
        marked_down = [v for v in variants if money(v.get("compareAtPrice")) is not None]

        if end is None:
            if marked_down:
                self.flag(ERROR, product, "pricing",
                          f"{len(marked_down)} variants have a compare-at price but no pgm:sale-YYYY-MM-DD tag")
            return

        if end < self.today and marked_down:
            self.flag(ERROR, product, "pricing",
                      f"sale program ended {end.isoformat()} but {len(marked_down)} variants "
                      "still show compare-at prices")
        for variant in variants:
            price = money(variant["price"])
            compare_at = money(variant.get("compareAtPrice"))
            if compare_at is None:
                self.flag(ERROR, product, "pricing", f"{variant['title']}: on sale but has no compare-at price")
            elif compare_at <= price:
                self.flag(ERROR, product, "pricing",
                          f"{variant['title']}: compare-at {compare_at:.2f} is not above price {price:.2f}")

    # --- Options ----------------------------------------------------------

    def check_options(self, product: dict) -> None:
        options = product.get("options", [])
        expected = math.prod(len(option["values"]) for option in options) if options else 1
        actual = len(variants_of(product))
        if actual != expected:
            self.flag(WARNING, product, "options",
                      f"{actual} variants for {expected} option combinations (gaps in the color/size matrix)")

        sizes = next((option["values"] for option in options if option["name"] == "Size"), None)
        if sizes and not all(s.isdigit() for s in sizes):
            order = self.std["size_order"]
            unknown = [s for s in sizes if s not in order]
            if unknown:
                self.flag(ERROR, product, "options", f"size values not in the size scale: {', '.join(unknown)}")
            elif sizes != sorted(sizes, key=order.index):
                self.flag(WARNING, product, "options", f"sizes are out of order: {' / '.join(sizes)}")
        elif sizes and sizes != sorted(sizes, key=int):
            self.flag(WARNING, product, "options", f"waist sizes are out of order: {' / '.join(sizes)}")

    # --- Media and SEO ------------------------------------------------------

    def check_media(self, product: dict) -> None:
        media = product.get("media", {}).get("nodes", [])
        minimum = self.std["media"]["min_images"]
        if len(media) < minimum:
            self.flag(WARNING, product, "media", f"{len(media)} images; the standard is at least {minimum}")
        missing_alt = sum(1 for item in media if not (item.get("alt") or "").strip())
        if missing_alt:
            self.flag(ERROR, product, "media", f"{missing_alt} images have no alt text")
        if media and product["title"].lower() not in (media[0].get("alt") or "").lower():
            self.flag(WARNING, product, "media",
                      f"featured image alt text doesn't name the product: \"{media[0].get('alt')}\"")

    def check_seo(self, product: dict) -> None:
        seo = product.get("seo") or {}
        limits = self.std["seo"]
        for field, limit in (("title", limits["title_max"]), ("description", limits["description_max"])):
            value = (seo.get(field) or "").strip()
            if not value:
                self.flag(WARNING, product, "seo", f"no custom SEO {field}")
            elif len(value) > limit:
                self.flag(WARNING, product, "seo",
                          f"SEO {field} is {len(value)} characters; search results cut off around {limit}")

    # --- Whole catalog ------------------------------------------------------

    def check_catalog(self, products: list[dict]) -> None:
        sku_owners: dict[str, list[str]] = defaultdict(list)
        style_owners: dict[str, set[str]] = defaultdict(set)
        for product in products:
            for variant in variants_of(product):
                sku = variant.get("sku")
                if sku:
                    sku_owners[sku].append(product["title"])
                    parts = sku.split("-")
                    if len(parts) == 5:
                        style_owners[f"{parts[1]}-{parts[2]}"].add(product["title"])
        for sku, owners in sorted(sku_owners.items()):
            if len(owners) > 1:
                self.flag(ERROR, owners[0], "sku", f"SKU {sku} is used {len(owners)} times")
        for style, owners in sorted(style_owners.items()):
            if len(owners) > 1:
                self.flag(ERROR, sorted(owners)[0], "sku",
                          f"style {style} is shared by {', '.join(sorted(owners))}")

        # One extended-size convention per catalog: 2XL/3XL or 1X/2X/3X, not both.
        conventions = self.std["extended_size_conventions"]
        users: dict[str, list[str]] = {name: [] for name in conventions}
        for product in products:
            sizes = next((o["values"] for o in product.get("options", []) if o["name"] == "Size"), [])
            for name, marks in conventions.items():
                if any(size in marks for size in sizes):
                    users[name].append(product["title"])
        if all(users.values()):
            majority = max(users, key=lambda name: len(users[name]))
            for name, titles in users.items():
                if name == majority:
                    continue
                for title in titles:
                    self.flag(WARNING, title, "sizes",
                              f"uses {'/'.join(conventions[name])} while {len(users[majority])} other products "
                              f"use {'/'.join(conventions[majority])}")


def inventory_report(products: list[dict], threshold: int) -> dict[str, list[dict]]:
    out, low = [], []
    for product in products:
        for variant in variants_of(product):
            quantity = variant.get("inventoryQuantity") or 0
            row = {"product": product["title"], "variant": variant["title"],
                   "sku": variant.get("sku"), "quantity": quantity}
            if quantity <= 0:
                out.append(row)
            elif quantity < threshold:
                low.append(row)
    return {"out_of_stock": out, "low_stock": low}


def render_text(products, findings, inventory, today, threshold) -> str:
    variant_count = sum(len(variants_of(p)) for p in products)
    lines = [f"Redline Motor Club catalog audit: {len(products)} products, "
             f"{variant_count} variants, as of {today.isoformat()}", ""]
    for level, mark, heading in ((ERROR, "x", "ERRORS"), (WARNING, "!", "WARNINGS")):
        hits = [f for f in findings if f.level == level]
        lines.append(f"{heading} ({len(hits)})")
        for f in hits:
            lines.append(f"  {mark} {f.product} [{f.rule}] {f.message}")
        lines.append("")
    lines.append(f"INVENTORY: {len(inventory['out_of_stock'])} out of stock, "
                 f"{len(inventory['low_stock'])} below {threshold}")
    for label, rows in (("out", inventory["out_of_stock"]), ("low", inventory["low_stock"])):
        for row in rows:
            lines.append(f"  {label:>3}  {row['quantity']:>3}  {row['product']} / {row['variant']}  {row['sku']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("catalog", nargs="?", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--standards", type=Path, default=DEFAULT_STANDARDS)
    parser.add_argument("--today", type=dt.date.fromisoformat, default=dt.date.today(),
                        help="date to check sale programs against (YYYY-MM-DD)")
    parser.add_argument("--json", action="store_true", help="print findings as JSON")
    args = parser.parse_args(argv)

    standards = json.loads(args.standards.read_text(encoding="utf-8"))
    products = load_products(args.catalog)
    findings = Auditor(standards, args.today).run(products)
    threshold = standards["inventory"]["low_stock_threshold"]
    inventory = inventory_report(products, threshold)

    if args.json:
        print(json.dumps({"findings": [asdict(f) for f in findings], "inventory": inventory}, indent=2))
    else:
        print(render_text(products, findings, inventory, args.today, threshold))
    return 1 if any(f.level == ERROR for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
