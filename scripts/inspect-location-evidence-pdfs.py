"""Verify and render actual saved-location acceptance exports; never edits the PDFs."""
import hashlib
import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


class BodyText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.parts = []

    def handle_starttag(self, tag, _attrs):
        if tag == "body":
            self.in_body = True

    def handle_endtag(self, tag):
        if tag == "body":
            self.in_body = False

    def handle_data(self, value):
        if self.in_body and value.strip():
            self.parts.append(value)


def compact(value):
    return re.sub(r"\s+", "", value)


def inspect(pdf, html):
    reader = PdfReader(pdf)
    pages = [page.extract_text() or "" for page in reader.pages]
    assert pages and all(page.strip() for page in pages), "Blank PDF page"
    parser = BodyText()
    parser.feed(html.read_text(encoding="utf-8"))
    document = compact("\n".join(pages))
    assert "AtlasWatch0.7.0" in document, "Incorrect product version"
    assert "AtlasWatchlocationbriefing" in document
    checked = 0
    for part in parser.parts:
        value = compact(part)
        if len(value) < 2:
            continue
        assert value in document, "Exported PDF lost body text: " + part[:160]
        checked += 1
    bounds = []
    with pdfplumber.open(pdf) as measured:
        for number, page in enumerate(measured.pages, 1):
            words = page.extract_words()
            margins = {
                "left": min(word["x0"] for word in words),
                "top": min(word["top"] for word in words),
                "right": page.width - max(word["x1"] for word in words),
                "bottom": page.height - max(word["bottom"] for word in words),
            }
            assert min(margins.values()) >= 35, "Print-safe margin violated"
            bounds.append({"page": number, "textMarginsPt": margins})
    renderer = shutil.which("pdftoppm")
    assert renderer, "Poppler pdftoppm is required for visual inspection"
    prefix = pdf.parent / (pdf.stem + "-page")
    for image in pdf.parent.glob(prefix.name + "-*.png"):
        assert image.resolve().parent == pdf.parent.resolve()
        assert re.fullmatch(re.escape(prefix.name) + r"-\d+\.png", image.name)
        image.unlink()
    subprocess.run([renderer, "-png", "-r", "100", str(pdf), str(prefix)], check=True, capture_output=True)
    images = sorted(pdf.parent.glob(prefix.name + "-*.png"))
    assert len(images) == len(pages)
    return {"pdf": str(pdf), "html": str(html), "bytes": pdf.stat().st_size,
            "sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "pages": len(pages),
            "allBodyTextChunksVerified": checked, "bounds": bounds,
            "renderedPages": [str(image) for image in images]}


def main():
    root = Path(__file__).resolve().parents[1]
    output = root / "docs" / "screenshots" / "location-evidence"
    pairs = [(output / "location-before-2.pdf", output / "location-before-1.html")]
    for log in ["location-evidence-fixtures.log", "location-evidence-packaged.log"]:
        path = root / "docs" / log
        if not path.exists():
            continue
        audit = json.loads(path.read_text(encoding="utf-8"))
        assert audit["result"] == "PASS", "Acceptance log has not passed: " + log
        for phase in audit["phases"]:
            exported = phase["exports"]
            html = next(Path(item["path"]) for item in exported if item["format"] == "html")
            for item in exported:
                if item["format"] == "pdf":
                    pairs.append((Path(item["path"]), html))
    results = [inspect(pdf, html) for pdf, html in pairs]
    report = {"result": "PASS", "files": results,
              "visualReview": "Rendered pages require separate human/agent visual review; text/bounds alone do not establish print appearance."}
    (output / "location-pdf-inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"result": "PASS", "pdfs": len(results), "pages": sum(item["pages"] for item in results),
                      "files": [{"path": item["pdf"], "pages": item["pages"], "chunks": item["allBodyTextChunksVerified"]} for item in results]}, indent=2))


if __name__ == "__main__":
    main()
