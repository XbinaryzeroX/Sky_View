"""Read-only text and page rendering checks for actual app-generated QA PDFs."""
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from pypdf import PdfReader
import pdfplumber


def compact(value):
    return re.sub(r"\s+", "", value)


def inspect(pdf, html):
    reader = PdfReader(pdf)
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(pages)
    source = html.read_text(encoding="utf-8")
    assert pages and all(page.strip() for page in pages), "Blank PDF page"
    assert "Atlas Watch 0.7.0" in text, "Wrong product version in PDF"
    heading = re.search(r"<h1>(.*?)</h1>", source).group(1)
    assert compact(heading) in compact(text), "PDF lost its report heading"
    timestamps = sorted(set(re.findall(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", source)))
    for value in timestamps:
        assert compact(value) in compact(text), "PDF lost exact observation time: " + value
    bounds = []
    with pdfplumber.open(pdf) as measured:
        for index, page in enumerate(measured.pages):
            words = page.extract_words()
            assert words, "No measurable PDF text on page"
            margins = {
                "left": min(word["x0"] for word in words),
                "top": min(word["top"] for word in words),
                "right": page.width - max(word["x1"] for word in words),
                "bottom": page.height - max(word["bottom"] for word in words),
            }
            assert min(margins.values()) >= 35, "Text crosses the print-safe margin on page " + str(index + 1)
            bounds.append({"page": index + 1, "pageWidthPt": page.width, "pageHeightPt": page.height, "textMarginsPt": margins})
    if "location briefing" in heading:
        for value in ["QA original location briefing", "QA selected location notes", "Data sources and freshness"]:
            assert compact(value) in compact(text), "Location PDF lost " + value
    else:
        for value in ["No longer returned", "Unknown is not zero", "National Weather Service", "USGS Earthquake Hazards Program", "not every intervening revision"]:
            assert compact(value) in compact(text), "Visit PDF lost " + value
    renderer = shutil.which("pdftoppm")
    assert renderer, "Poppler pdftoppm is required for visual review"
    prefix = pdf.parent / (pdf.stem + "-page")
    # Clear only this script's numbered pages inside its explicit QA output folder.
    # A shorter re-export must not leave an obsolete page looking current.
    for image in pdf.parent.glob(prefix.name + "-*.png"):
        assert image.resolve().parent == pdf.parent.resolve()
        assert re.fullmatch(re.escape(prefix.name) + r"-\d+\.png", image.name)
        image.unlink()
    subprocess.run([renderer, "-png", "-r", "100", str(pdf), str(prefix)], check=True, capture_output=True)
    images = sorted(pdf.parent.glob(prefix.name + "-*.png"))
    assert len(images) == len(pages), "Not every PDF page was rendered"
    return {
        "pdf": str(pdf), "bytes": pdf.stat().st_size,
        "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
        "pages": len(pages), "textCharacters": [len(page) for page in pages],
        "exactObservationTimesChecked": timestamps,
        "headingAndSemanticsVerified": True,
        "pageBounds": bounds,
        "renderedPages": [str(image) for image in images],
    }


def main():
    root = Path(__file__).resolve().parents[1]
    output = root / "docs" / "screenshots" / "visit"
    before = output / "audit-visit-print-before.png"
    previous = output / "visit-fixture-positive-2-page-2.png"
    if not before.exists() and previous.exists():
        before.write_bytes(previous.read_bytes())
    pairs = [
        ("visit-first-2.pdf", "visit-first-1.html"),
        ("visit-second-2.pdf", "visit-second-1.html"),
        ("visit-second-4.pdf", "visit-second-3.html"),
        ("visit-fixture-positive-2.pdf", "visit-fixture-positive-1.html"),
    ]
    result = [inspect(output / pdf, output / html) for pdf, html in pairs]
    (output / "visit-pdf-inspection.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
