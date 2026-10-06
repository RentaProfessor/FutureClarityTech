import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import export_catalog  # noqa: E402


def page(titles, has_next, cursor=None):
    nodes = [{"title": t, "handle": t.lower(), "productType": "Hats", "status": "ACTIVE", "tags": ["drop:01"],
              "variants": {"nodes": [{"title": "Black", "sku": f"SKU-{t}", "price": "10.00",
                                      "compareAtPrice": None, "inventoryQuantity": 3}]}}
             for t in titles]
    body = {"data": {"products": {"nodes": nodes, "pageInfo": {"hasNextPage": has_next, "endCursor": cursor}}}}
    return io.BytesIO(json.dumps(body).encode())


class FetchProductsTest(unittest.TestCase):
    def test_follows_cursors_until_the_last_page(self):
        responses = [page(["A", "B"], True, "cursor-1"), page(["C"], False)]
        with mock.patch.object(export_catalog.urllib.request, "urlopen", side_effect=responses) as urlopen:
            products = export_catalog.fetch_products("shop.myshopify.com", "token")
        self.assertEqual([p["title"] for p in products], ["A", "B", "C"])
        second_request = urlopen.call_args_list[1].args[0]
        self.assertEqual(json.loads(second_request.data)["variables"], {"after": "cursor-1"})
        self.assertEqual(second_request.get_header("X-shopify-access-token"), "token")
        self.assertIn("/admin/api/", second_request.full_url)

    def test_graphql_errors_raise(self):
        error = io.BytesIO(json.dumps({"errors": [{"message": "Access denied"}]}).encode())
        with mock.patch.object(export_catalog.urllib.request, "urlopen", return_value=error):
            with self.assertRaises(RuntimeError):
                export_catalog.fetch_products("shop.myshopify.com", "token")


class CsvTest(unittest.TestCase):
    def test_one_row_per_variant(self):
        products = json.loads(page(["A", "B"], False).read())["data"]["products"]["nodes"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "products.csv"
            export_catalog.write_csv(products, path)
            rows = list(csv.DictReader(path.open()))
        self.assertEqual([r["sku"] for r in rows], ["SKU-A", "SKU-B"])
        self.assertEqual(rows[0]["compare_at_price"], "")


if __name__ == "__main__":
    unittest.main()
