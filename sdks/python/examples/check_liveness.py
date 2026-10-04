"""Example: check liveness from a sequence of webcam frames.

Run with::

    CIRKLE_API_KEY=cvk_xxx python examples/check_liveness.py frame1.jpg frame2.jpg frame3.jpg

Demonstrates passing multiple frames (as file paths) plus a challenge
type to the Cirkle liveness endpoint, then interpreting the score +
signals breakdown.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cirkle_verify import (  # noqa: E402
    CirkleError,
    CirkleVerify,
    ValidationError,
)


def main() -> int:
    api_key = os.environ.get("CIRKLE_API_KEY")
    base_url = os.environ.get("CIRKLE_BASE_URL", "https://cirkle-verify.vercel.app")
    frame_paths = sys.argv[1:]
    challenge = os.environ.get("CIRKLE_LIVENESS_CHALLENGE", "turn_left")

    if not api_key:
        print("Set CIRKLE_API_KEY environment variable first.")
        return 2
    if not frame_paths:
        print("Pass at least one frame path, e.g. python check_liveness.py f1.jpg f2.jpg")
        return 2

    client = CirkleVerify(api_key=api_key, base_url=base_url)

    try:
        result = client.check_liveness(
            frames=frame_paths,
            challenge_type=challenge,
        )
    except ValidationError as e:
        print(f"Bad request: {e}")
        return 4
    except CirkleError as e:
        print(f"SDK error: {e}")
        return 1

    print("─── Liveness verdict ──────────────────────────────")
    print(f"  Passed:           {result.passed if result.passed is not None else result.is_live}")
    print(f"  Score:            {result.score}")
    print(f"  Detected actions: {result.detected_actions}")
    print(f"  Reasoning:        {result.reasoning}")
    if result.signals:
        print("  ── Signals breakdown ──")
        print(f"    Motion:             {result.signals.motion_score}")
        print(f"    Challenge:          {result.signals.challenge_score}")
        print(f"    Print attack:       {result.signals.print_attack_score}")
        print(f"    Screen artifact:    {result.signals.screen_artifact_score}")
        print(f"    Depth:              {result.signals.depth_score}")
        print(f"    Motion smoothness:  {result.signals.motion_smoothness_score}")
        print(f"    Velocity profile:   {result.signals.velocity_profile_score}")
        print(f"    Total (pro):        {result.signals.total_score}")
        if result.signals.issues:
            print(f"    Issues:             {result.signals.issues}")
        if result.signals.suggestions:
            print(f"    Suggestions:        {result.signals.suggestions}")
    print(f"  Engine:           {result.engine}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
