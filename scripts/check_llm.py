"""Small connectivity check for the configured local/cloud explanation provider."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / ".env", override=False)

from ai.models.llm import provider  # noqa: E402


FACTS = {
    "audience": "Validated 1200 subscribers.",
    "pilots": "Completed 3 actual pilots.",
    "portfolio": "Selected 2 evidence-backed campaigns.",
}


def main() -> int:
    model, reason = provider()
    print(f"LLM_MODE={os.getenv('LLM_MODE', '<auto>')}")
    print(f"provider={type(model).__name__}")
    if reason:
        print(f"configuration={reason}")
    text, mode = model.explain(FACTS)
    print(f"result_mode={mode}")
    print(f"result={text}")
    return 0 if mode == "llm_ordered_verified_facts" else 2


if __name__ == "__main__":
    raise SystemExit(main())
