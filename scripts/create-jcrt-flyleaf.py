#!/usr/bin/env python3
"""Create a JSTOR-style JCRT flyleaf PDF."""

import argparse
import html
import subprocess
import tempfile
from pathlib import Path

from reportlab.lib.colors import HexColor, black
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
JCRT_LOGO = ROOT / "public/images/logos/jcrt.svg"
WHITESTONE_LOGO = (
    ROOT.parent
    / "thewhitestonefoundation.org/src/static/images/whitestone-logo-square-transparent.svg"
)
PAGE = (612, 792)
LEFT = 54
RED = HexColor("#bf232e")
MUTED = HexColor("#555555")


def register_fonts() -> None:
    if "JCRTSerif" in pdfmetrics.getRegisteredFontNames():
        return
    roots = (Path("/usr/local/texlive"), Path("/usr/share/fonts"), Path("/opt/homebrew/share/fonts"))
    names = {
        "JCRTSerif": "NotoSerif-Regular.ttf",
        "JCRTSerif-Bold": "NotoSerif-Bold.ttf",
        "JCRTSerif-Italic": "NotoSerif-Italic.ttf",
        "JCRTSerif-BoldItalic": "NotoSerif-BoldItalic.ttf",
    }
    paths = {}
    for font_name, filename in names.items():
        paths[font_name] = next((path for root in roots if root.exists() for path in root.glob(f"**/{filename}")), None)
        if paths[font_name] is None:
            raise FileNotFoundError(f"required Unicode font not found: {filename}")
        pdfmetrics.registerFont(TTFont(font_name, paths[font_name]))
    pdfmetrics.registerFontFamily(
        "JCRTSerif",
        normal="JCRTSerif",
        bold="JCRTSerif-Bold",
        italic="JCRTSerif-Italic",
        boldItalic="JCRTSerif-BoldItalic",
    )


def svg_png(source: Path, target: Path, width: int) -> None:
    subprocess.run(
        ["rsvg-convert", "--width", str(width), "--output", str(target), str(source)],
        check=True,
    )


def paragraph(pdf, html: str, x: float, y: float, width: float, size=12.5, leading=16):
    style = ParagraphStyle(
        "flyleaf",
        fontName="JCRTSerif",
        fontSize=size,
        leading=leading,
        textColor=black,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    item = Paragraph(html, style)
    _, height = item.wrap(width, 200)
    item.drawOn(pdf, x, y - height)
    return y - height


def labeled(pdf, label: str, value: str, y: float, link: str | None = None) -> float:
    label_html = f"<b>{label}:</b>"
    safe_value = html.escape(value)
    value_html = f'<link href="{html.escape(link, quote=True)}" color="#555555"><u>{safe_value}</u></link>' if link else safe_value
    return paragraph(pdf, f"{label_html} {value_html}", LEFT, y, pdf._pagesize[0] - LEFT * 2) - 6


def build(args, assets: tuple[Path, Path] | None = None) -> None:
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    def render(jcrt_png: Path, whitestone_png: Path) -> None:
        register_fonts()
        page = (args.page_width, args.page_height)
        right = page[0] - LEFT
        top = page[1] - 54
        pdf = canvas.Canvas(str(output), pagesize=page, pageCompression=1)
        pdf.setTitle(f"{args.title} - JCRT flyleaf")
        pdf.setAuthor(", ".join(args.author))
        pdf.setSubject("Journal for Cultural and Religious Theory publication flyleaf")

        pdf.drawImage(ImageReader(jcrt_png), LEFT, top - 48, 48, 48, preserveAspectRatio=True, mask="auto")
        pdf.setFont("JCRTSerif-Bold", 15)
        pdf.setFillColor(black)
        pdf.drawString(110, top - 30, "Journal for Cultural and Religious Theory")
        pdf.setFont("JCRTSerif", 9.5)
        pdf.setFillColor(MUTED)
        pdf.drawString(110, top - 45, "ISSN 1530-5228")
        pdf.setStrokeColor(black)
        pdf.setLineWidth(1)
        pdf.line(LEFT, top - 49, right, top - 49)

        y = top - 76
        pdf.setFont("JCRTSerif-Bold", 13)
        pdf.setFillColor(RED)
        pdf.drawString(LEFT, y, f"TYPE: {args.type}")
        y -= 28
        y = labeled(pdf, "Title", args.title, y)
        y = labeled(pdf, "Author(s)", ", ".join(args.author), y)
        y = labeled(pdf, "Source", "Journal for Cultural and Religious Theory (JCRT)", y)
        y = labeled(pdf, "Published by", "Whitestone Publications", y)
        y = labeled(pdf, "Stable URL", args.stable_url, y, args.stable_url)
        y = labeled(pdf, "DOI (newest version)", args.doi, y, f"https://doi.org/{args.doi}")

        pdf.setStrokeColor(black)
        pdf.setLineWidth(0.9)
        pdf.line(LEFT, y - 2, right, y - 2)
        y -= 22
        rights = (
            "Copyright © held by the author(s). All rights reserved. This text may be used and "
            "shared in accordance with the fair-use provisions of U.S. copyright law. Any use "
            "of this text in other ways requires the consent of the author and the publisher, "
            "the <i>Journal for Cultural and Religious Theory</i>, and must cite publication in "
            "this journal."
        )
        y = paragraph(pdf, rights, LEFT, y, right - LEFT, size=10.2, leading=13) - 8
        paragraph(
            pdf,
            '<link href="https://jcrt.org/copyright/" color="#555555"><u>https://jcrt.org/copyright/</u></link>',
            LEFT,
            y,
            right - LEFT,
            size=10.2,
            leading=13,
        )

        pdf.setStrokeColor(HexColor("#d2d2d2"))
        pdf.line(LEFT, 68, right, 68)
        pdf.drawImage(
            ImageReader(whitestone_png), LEFT, 20, 42, 42, preserveAspectRatio=True, anchor="c", mask="auto"
        )
        pdf.setFillColor(black)
        pdf.setFont("JCRTSerif-Bold", 12)
        pdf.drawString(116, 50, "WHITESTONE PUBLICATIONS")
        pdf.setFont("JCRTSerif", 9.5)
        pdf.drawString(116, 34, "Publisher of the Journal for Cultural and Religious Theory (JCRT)")
        pdf.setFillColor(MUTED)
        pdf.setFont("JCRTSerif", 8.5)
        pdf.drawCentredString(page[0] / 2, 16, "JCRT  |  jcrt.org  |  ISSN 1530-5228")

        pdf.showPage()
        pdf.save()

    if assets:
        render(*assets)
    else:
        with tempfile.TemporaryDirectory(prefix="jcrt-flyleaf-") as temp_dir:
            temp = Path(temp_dir)
            jcrt_png = temp / "jcrt.png"
            whitestone_png = temp / "whitestone.png"
            svg_png(JCRT_LOGO, jcrt_png, 180)
            svg_png(WHITESTONE_LOGO, whitestone_png, 220)
            render(jcrt_png, whitestone_png)

    assert output.read_bytes().startswith(b"%PDF-") and output.stat().st_size > 10_000


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", choices=("Article", "Review"), default="Article")
    parser.add_argument("--title", default="[Title]")
    parser.add_argument("--author", action="append", default=None, help="Repeat for multiple authors")
    parser.add_argument("--stable-url", default="https://jcrt.org/[permalink-or-doi]")
    parser.add_argument("--doi", default="10.17613/[newest-version-doi]")
    parser.add_argument("--page-width", type=float, default=PAGE[0])
    parser.add_argument("--page-height", type=float, default=PAGE[1])
    parser.add_argument("--output", default=str(ROOT / "output/pdf/jcrt-flyleaf-template.pdf"))
    args = parser.parse_args()
    args.author = args.author or ["[Author name(s)]"]
    return args


if __name__ == "__main__":
    build(parse_args())
