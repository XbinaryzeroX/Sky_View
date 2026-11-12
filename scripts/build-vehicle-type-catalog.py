"""Extract the shape and engine columns of FAA Order JO 7360.1K, Appendix A.

Usage: python scripts/build-vehicle-type-catalog.py path/to/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf
Requires pdfplumber at build time only. The renderer uses the bundled JSON offline.
Source: https://www.faa.gov/documentLibrary/media/Order/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf
"""
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pdfplumber


INPUT_SHA = "64a709bf8863e177c3daffade253aa6362519186ba807943165f68490ee0c8fe"
FORMS = {"Fixed-wing": "L", "@Fixed-wing": "A", "$Fixed-wing": "S",
         "Helicopter": "H", "Gyroplane": "G", "Powered-lift": "P"}


def extract(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != INPUT_SHA:
        raise ValueError("Unexpected source revision. Review table columns and pages before regenerating.")
    types = {}
    counts = Counter()
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[9:121]:
            # Reading the whole page in text order mixes multi-line manufacturer names with neighboring rows.
            # In this revision the first three columns share a baseline. Ignore all operational columns.
            words = page.crop((65, 105, 200, 747)).extract_words()
            codes = [w for w in words if w["x0"] < 107 and re.fullmatch(r"[A-Z0-9]{1,4}\*?", w["text"])]
            for word in codes:
                code = word["text"]
                if code.endswith("*"):
                    continue  # The order marks single-piloted military turbojets with an asterisk.
                cells = [w["text"] for w in words if abs(w["top"] - word["top"]) < 1.4 and w["x0"] > 110]
                form = next((FORMS[c] for c in cells if c in FORMS), None)
                engine = next((re.fullmatch(r"(\d)([PJTE])/([A-Z]\+?)", c) for c in cells if "/" in c), None)
                if not form or not engine:
                    continue
                if code in types:
                    raise ValueError(f"Repeated type in Appendix A: {code}")
                count, power, weight = engine.groups()
                types[code] = form + count + power + weight
                counts[form] += 1
            page.close()
    return types, counts


if __name__ == "__main__":
    output, counts = extract(Path(sys.argv[1]))
    for code, expected in {"R44": "H1PS", "EC35": "H2TS", "C172": "L1PS", "A320": "L2JL",
                           "AT76": "L2TL", "B77W": "L2JH", "A002": "G1PS"}.items():
        if output.get(code) != expected:
            raise ValueError(f"Unexpected entry for {code}: {output.get(code)}")
    data = json.dumps(dict(sorted(output.items())), indent=2) + "\n"
    target = Path(__file__).resolve().parents[1] / "src/shared/aircraftTypeShapes.json"
    target.write_text(data, encoding="utf-8", newline="\n")
    print(f"{len(output)} designators: {dict(sorted(counts.items()))}")
