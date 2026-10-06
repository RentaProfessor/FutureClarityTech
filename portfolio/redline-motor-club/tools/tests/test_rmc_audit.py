import contextlib
import datetime as dt
import io
import json
import sys
import unittest
from itertools import product as cartesian
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import rmc_audit  # noqa: E402

STANDARDS = json.loads(rmc_audit.DEFAULT_STANDARDS.read_text())
DURING_SALE = dt.date(2026, 9, 15)
AFTER_SALE = dt.date(2026, 10, 6)
EXPORTED_ON = dt.date(2026, 10, 6)  # when catalog/catalog.json was exported
CATALOG_SALE_ENDS = "2026-12-31"   # the live markdown program in that export


def make_product(title="Test Trucker", product_type="Hats", sku_stem="RMC-HAT-TST",
                 colors=("Black", "Bone"), sizes=None, tags=None, compare_at=None,
                 alts=None, seo=None):
    color_codes = {name: code for code, name in STANDARDS["colors"].items()}
    size_codes = {name: code for code, name in STANDARDS["sizes"].items()}
    options = [{"name": "Color", "values": list(colors)}]
    if sizes:
        options.append({"name": "Size", "values": list(sizes)})
    variants = []
    for combo in cartesian(colors, sizes or [None]):
        color, size = combo
        selected = [{"name": "Color", "value": color}]
        if size:
            selected.append({"name": "Size", "value": size})
        variants.append({
            "title": " / ".join(v for v in combo if v),
            "sku": f"{sku_stem}-{color_codes[color]}-{size_codes[size] if size else 'OS'}",
            "price": "40.00",
            "compareAtPrice": compare_at,
            "inventoryQuantity": 10,
            "selectedOptions": selected,
        })
    alts = alts if alts is not None else [f"{title} in {colors[0]}", f"{title} detail"]
    return {
        "title": title,
        "productType": product_type,
        "tags": tags if tags is not None else ["dept:unisex", "drop:01", "fit:regular", "mat:mesh-twill"],
        "options": options,
        "seo": seo if seo is not None else {"title": f"{title} | Redline Motor Club", "description": "A hat."},
        "media": {"nodes": [{"alt": alt, "mediaContentType": "IMAGE"} for alt in alts]},
        "variants": {"nodes": variants},
    }


def audit(products, today=DURING_SALE):
    return rmc_audit.Auditor(STANDARDS, today).run(products)


def messages(findings, level=None):
    return [f.message for f in findings if level is None or f.level == level]


class RealCatalogTest(unittest.TestCase):
    def setUp(self):
        self.products = rmc_audit.load_products(rmc_audit.DEFAULT_CATALOG)

    def test_catalog_passes_on_its_export_date(self):
        findings = audit(self.products, EXPORTED_ON)
        self.assertEqual(messages(findings, rmc_audit.ERROR), [])
        self.assertEqual([f.product for f in findings], ["Board Swim Short"])

    def test_markdowns_become_errors_once_the_program_ends(self):
        day_after = dt.date.fromisoformat(CATALOG_SALE_ENDS) + dt.timedelta(days=1)
        errors = [f for f in audit(self.products, day_after) if f.level == rmc_audit.ERROR]
        self.assertEqual({f.product for f in errors},
                         {"Foam Front Trucker", "Crossbody Sling", "Baby Tee", "Ribbed Tank"})
        self.assertTrue(all(f"sale program ended {CATALOG_SALE_ENDS}" in f.message for f in errors))

    def test_every_sku_is_unique(self):
        skus = [v["sku"] for p in self.products for v in p["variants"]["nodes"]]
        self.assertEqual(len(skus), len(set(skus)))


class SkuRulesTest(unittest.TestCase):
    def test_well_formed_product_passes(self):
        self.assertEqual(audit([make_product()]), [])

    def test_color_code_must_match_the_color_option(self):
        product = make_product()
        product["variants"]["nodes"][0]["sku"] = "RMC-HAT-TST-WHT-OS"
        self.assertIn("color code WHT is White, variant says Black", " ".join(messages(audit([product]))))

    def test_size_code_must_match_the_size_option(self):
        product = make_product(product_type="T-Shirts", sku_stem="RMC-TEE-TST", sizes=("S", "M"))
        product["variants"]["nodes"][0]["sku"] = "RMC-TEE-TST-BLK-MD"
        self.assertIn("size code MD is M, variant says S", " ".join(messages(audit([product]))))

    def test_one_size_products_use_os(self):
        product = make_product()
        product["variants"]["nodes"][0]["sku"] = "RMC-HAT-TST-BLK-XL"
        self.assertIn("one-size products use size code OS", " ".join(messages(audit([product]))))

    def test_category_code_must_match_product_type(self):
        product = make_product(product_type="Bags")
        self.assertIn("category HAT is for Hats, but the product type is Bags", " ".join(messages(audit([product]))))

    def test_duplicate_skus_across_products(self):
        first = make_product(title="First Trucker")
        second = make_product(title="Second Trucker")
        joined = " ".join(messages(audit([first, second])))
        self.assertIn("SKU RMC-HAT-TST-BLK-OS is used 2 times", joined)
        self.assertIn("style HAT-TST is shared by First Trucker, Second Trucker", joined)


class TagRulesTest(unittest.TestCase):
    def test_required_namespace_missing(self):
        product = make_product(tags=["dept:unisex", "drop:01", "fit:regular"])
        self.assertIn("needs exactly one mat: tag (missing)", messages(audit([product]), rmc_audit.ERROR))

    def test_value_outside_the_allowed_list(self):
        product = make_product(tags=["dept:everyone", "drop:01", "fit:regular", "mat:wool"])
        self.assertTrue(any("dept:everyone is not one of" in m for m in messages(audit([product]))))

    def test_drop_must_be_two_digits(self):
        product = make_product(tags=["dept:unisex", "drop:1", "fit:regular", "mat:wool"])
        self.assertTrue(any("drop:1 does not match" in m for m in messages(audit([product]))))


class PricingRulesTest(unittest.TestCase):
    SALE_TAGS = ["dept:unisex", "drop:00", "fit:regular", "mat:wool", "pgm:sale-2026-09-30"]

    def test_compare_at_without_a_sale_program(self):
        product = make_product(compare_at="50.00")
        self.assertTrue(any("no pgm:sale-YYYY-MM-DD tag" in m for m in messages(audit([product]))))

    def test_sale_variant_without_compare_at(self):
        product = make_product(tags=self.SALE_TAGS)
        self.assertTrue(any("on sale but has no compare-at price" in m for m in messages(audit([product]))))

    def test_compare_at_must_be_above_price(self):
        product = make_product(tags=self.SALE_TAGS, compare_at="40.00")
        self.assertTrue(any("is not above price" in m for m in messages(audit([product]))))

    def test_live_sale_inside_its_window_is_fine(self):
        product = make_product(tags=self.SALE_TAGS, compare_at="50.00")
        self.assertEqual(messages(audit([product], DURING_SALE), rmc_audit.ERROR), [])

    def test_markdown_still_live_after_the_program_ends(self):
        product = make_product(tags=self.SALE_TAGS, compare_at="50.00")
        self.assertEqual(messages(audit([product], AFTER_SALE), rmc_audit.ERROR),
                         ["sale program ended 2026-09-30 but 2 variants still show compare-at prices"])


class OptionAndContentRulesTest(unittest.TestCase):
    def test_sizes_out_of_order(self):
        product = make_product(product_type="T-Shirts", sku_stem="RMC-TEE-TST", sizes=("M", "S"))
        self.assertTrue(any("sizes are out of order" in m for m in messages(audit([product]))))

    def test_gap_in_the_color_size_matrix(self):
        product = make_product(product_type="T-Shirts", sku_stem="RMC-TEE-TST", sizes=("S", "M"))
        product["variants"]["nodes"].pop()
        self.assertTrue(any("3 variants for 4 option combinations" in m for m in messages(audit([product]))))

    def test_mixed_extended_size_conventions(self):
        tees = [make_product(title=f"Tee {n}", product_type="T-Shirts", sku_stem=f"RMC-TEE-T{n}{n}",
                             sizes=("XL", "2XL")) for n in "AB"]
        swim = make_product(title="Swim", product_type="Swimwear", sku_stem="RMC-SWM-TST", sizes=("XL", "1X"))
        warnings = [f for f in audit(tees + [swim]) if f.rule == "sizes"]
        self.assertEqual([f.product for f in warnings], ["Swim"])

    def test_missing_alt_text_is_an_error(self):
        product = make_product(alts=["Test Trucker in Black", ""])
        self.assertIn("1 images have no alt text", messages(audit([product]), rmc_audit.ERROR))

    def test_long_seo_title_is_a_warning(self):
        product = make_product(seo={"title": "x" * 75, "description": "ok"})
        self.assertTrue(any("SEO title is 75 characters" in m for m in messages(audit([product]))))


class CliTest(unittest.TestCase):
    def test_exit_code_reflects_errors(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(rmc_audit.main(["--today", "2026-10-06", "--json"]), 0)
            self.assertEqual(rmc_audit.main(["--today", "2027-01-01", "--json"]), 1)


if __name__ == "__main__":
    unittest.main()
