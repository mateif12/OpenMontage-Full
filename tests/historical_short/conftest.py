import sys
from pathlib import Path

# scripts/historical_short is a script folder, not a package
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "historical_short"))
