from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/datasets", tags=["datasets"])


_FEATURED_PATH = Path(__file__).resolve().parents[1] / "data" / "featured_311.json"


@router.get("/featured", summary="Return a curated 2020-2025 NYC dataset")
def get_featured_dataset() -> dict[str, Any]:
    """Return the bundled NYC 311 2020-2025 sample without external dependencies.

    This endpoint is intended for demos; it does not hit Socrata, Postgres, or
    Firebase and works offline as long as the API server is running.
    """
    with _FEATURED_PATH.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    return {"featured": payload}
