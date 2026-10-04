"""Example: verify a national ID document with the Cirkle SDK.

Run with::

    CIRKLE_API_KEY=cvk_xxx python examples/verify_document.py path/to/id.jpg

This demonstrates the full document-verification flow: image load +
base64 encode, API call, error handling, and pretty-printing the
extracted fields.
"""

from __future__ import annotations

import os
import sys

# Allow running the example directly from a checkout (without pip install).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cirkle_verify import (  # noqa: E402
    AuthenticationError,
    CirkleError,
    CirkleVerify,
    RateLimitError,
    ServerError,
    ValidationError,
)


def main() -> int:
    api_key = os.environ.get("CIRKLE_API_KEY")
    base_url = os.environ.get("CIRKLE_BASE_URL", "https://cirkle-verify.vercel.app")
    image_path = sys.argv[1] if len(sys.argv) > 1 else "id_card.jpg"

    if not api_key:
        print("Set CIRKLE_API_KEY environment variable first.")
        return 2

    client = CirkleVerify(api_key=api_key, base_url=base_url)

    try:
        result = client.verify_document(
            image_path=image_path,
            doc_type="national_id",
            country="EG",
        )
    except ValidationError as e:
        print(f"Bad request: {e}")
        return 4
    except AuthenticationError as e:
        print(f"Auth failed: {e}")
        return 5
    except RateLimitError as e:
        print(f"Rate limited. Retry after {e.retry_after}s.")
        return 6
    except ServerError as e:
        print(f"Server error (HTTP {e.status}): {e}")
        return 7
    except CirkleError as e:
        print(f"SDK error: {e}")
        return 1

    fields = result.extracted_fields
    if fields is None:
        print("No fields extracted. Raw response:")
        print(result)
        return 0

    print("─── Extracted fields ─────────────────────────────")
    print(f"  Name (ar):     {fields.full_name_ar}")
    print(f"  Name (en):     {fields.full_name_en}")
    print(f"  National ID:   {fields.national_id}")
    print(f"  Birth date:    {fields.birth_date}")
    print(f"  Gender:        {fields.gender}")
    print(f"  Address:       {fields.address}")
    print(f"  Nationality:   {fields.nationality}")
    print(f"  Job:           {fields.job}")
    print(f"  Document no:   {fields.document_no}")
    print(f"  Expiry date:   {fields.expiry_date}")
    print(f"  Confidence:    {fields.confidence}")
    if fields.consensus:
        print(f"  Consensus:     {fields.consensus.verdict} ({fields.consensus.successful}/"
              f"{fields.consensus.total} providers, agreement={fields.consensus.agreement})")
    print(f"  Engine:        {result.engine}")
    print(f"  Elapsed (ms):  {result.elapsed_ms}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
