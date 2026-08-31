import sys
from pathlib import Path

SOURCE_DIRECTORY = Path(__file__).resolve().parent / "src"
source_path = str(SOURCE_DIRECTORY)
if source_path not in sys.path:
    sys.path.insert(0, source_path)

from memedrop_api.main import app  # noqa: E402

__all__ = ["app"]
