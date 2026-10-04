"""Example: face-match a document photo to a selfie.

Run with::

    CIRKLE_API_KEY=cvk_xxx python examples/face_match.py doc.jpg selfie.jpg

Demonstrates ``client.face_match(...)`` with two file paths, and shows
how to interpret ``matched``, ``score``, ``confidence``, and the
optional consensus metadata.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cirkle_verify import CirkleError, CirkleVerify, ValidationError  # noqa: E402


def main() -> int:
    api_key = os.environ.get("CIRKLE_API_KEY")
    base_url = os.environ.get("CIRKLE_BASE_URL", "https://cirkle-verify.vercel.app")

    args = sys.argv[1:]
    if not api_key:
        print("Set CIRKLE_API_KEY environment variable first.")
        return 2
    if len(args) < 2:
        print("Pass the document image path and the selfie path.")
        return 2

    client = CirkleVerify(api_key=api_key, base_url=base_url)

    try:
        match = client.face_match(document_image=args[0], selfie_image=args[1])
    except ValidationError as e:
        print(f"Bad request: {e}")
        return 4
    except CirkleError as e:
        print(f"SDK error: {e}")
        return 1

    matched = match.matched if match.matched is not None else match.is_match
    score = match.score if match.score is not None else match.similarity

    print("─── Face match ─────────────────────────────────────")
    print(f"  Matched:     {matched}")
    print(f"  Same person: {match.same_person}")
    print(f"  Score:       {score}")
    if match.consensus:
        print(f"  Consensus:   {match.consensus.verdict} "
              f"({match.consensus.successful}/{match.consensus.total}, "
              f"agreement={match.consensus.agreement})")
    print(f"  Reasoning:   {match.reasoning}")
    return 0 if matched else 1


if __name__ == "__main__":
    sys.exit(main())
