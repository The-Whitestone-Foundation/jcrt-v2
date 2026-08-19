#!/usr/bin/env python3
"""Create a JSTOR-style JCRT flyleaf PDF."""

import argparse
import subprocess
import tempfile
from pathlib import Path

from reportlab.lib.colors import HexColor, black
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
JCRT_LOGO = ROOT / "_site/images/logos/jcrt.svg"
WHITESTONE_LOGO = (
    ROOT.parent
    / "thewhitestonefoundation.org/src/static/images/whitestone-logo-square-transparent.svg"
)
PAGE = (595, 882)
LEFT, RIGHT = 48, 547
RED = HexColor("#bf232e")
MUTED = HexColor("#555555")


def svg_png(source: Path, target: Path, width: int) -> None:
    subprocess.run(
        ["rsvg-convert", "--width", str(width), "--output", str(target), str(source)],
        check=True,
    )


def paragraph(pdf, html: str, x: float, y: float, width: float, size=12.5, leading=16):
    style = ParagraphStyle(
        "flyleaf",
        fontName="Times-Roman",
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
    value_html = f'<link href="{link}" color="#555555"><u>{value}</u></link>' if link else value
    return paragraph(pdf, f"{label_html} {value_html}", LEFT, y, RIGHT - LEFT) - 8


def build(args) -> None:
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="jcrt-flyleaf-") as temp_dir:
        temp = Path(temp_dir)
        jcrt_png = temp / "jcrt.png"
        whitestone_png = temp / "whitestone.png"
        svg_png(JCRT_LOGO, jcrt_png, 180)
        svg_png(WHITESTONE_LOGO, whitestone_png, 220)

        pdf = canvas.Canvas(str(output), pagesize=PAGE, pageCompression=1)
        pdf.setTitle(f"{args.title} - JCRT flyleaf")
        pdf.setAuthor(", ".join(args.author))
        pdf.setSubject("Journal for Cultural and Religious Theory publication flyleaf")

        # Publisher mark and header rule.
        pdf.drawImage(ImageReader(jcrt_png), LEFT, 766, 70, 70, preserveAspectRatio=True, mask="auto")
        pdf.setFont("Times-Bold", 15)
        pdf.setFillColor(black)
        pdf.drawString(132, 804, "Journal for Cultural and Religious Theory")
        pdf.setFont("Times-Roman", 9.5)
        pdf.setFillColor(MUTED)
        pdf.drawString(132, 787, "ISSN 1530-5228")
        pdf.setStrokeColor(black)
        pdf.setLineWidth(1)
        pdf.line(LEFT, 754, RIGHT, 754)

        y = 724
        pdf.setFont("Times-Bold", 13)
        pdf.setFillColor(RED)
        pdf.drawString(LEFT, y, args.type.upper())
        y -= 28
        y = labeled(pdf, "Title", args.title, y)
        y = labeled(pdf, "Author(s)", ", ".join(args.author), y)
        y = labeled(pdf, "Source", "Journal for Cultural and Religious Theory (JCRT)", y)
        y = labeled(pdf, "Published by", "Whitestone Publications", y)
        y = labeled(pdf, "Stable URL", args.stable_url, y, args.stable_url)

        pdf.setStrokeColor(black)
        pdf.setLineWidth(0.9)
        pdf.line(LEFT, y - 2, RIGHT, y - 2)
        y -= 28

        notice = (
            '<link href="https://jcrt.org/" color="#555555"><u>The Journal for Cultural and '
            'Religious Theory (JCRT)</u></link> is an online, peer-reviewed, academic publication '
            'published by <link href="http://thewhitestonefoundation.org/" color="#555555">'
            '<u>The Whitestone Foundation</u></link>, a 501c3 corporation located in Boulder, '
            'Colorado. ISSN 1530-5228.'
        )
        y = paragraph(pdf, notice, LEFT, y, RIGHT - LEFT, size=10.2, leading=13) - 12
        rights = (
            "Copyright © held by the author(s). All rights reserved. This text may be used and "
            "shared in accordance with the fair-use provisions of U.S. copyright law. Any use "
            "of this text in other ways requires the consent of the author and the publisher, "
            "the <i>Journal for Cultural and Religious Theory</i>, and must cite publication in "
            "this journal."
        )
        y = paragraph(pdf, rights, LEFT, y, RIGHT - LEFT, size=10.2, leading=13) - 12
        paragraph(
            pdf,
            '<link href="https://jcrt.org/copyright/" color="#555555"><u>https://jcrt.org/copyright/</u></link>',
            LEFT,
            y,
            RIGHT - LEFT,
            size=10.2,
            leading=13,
        )

        # Bottom collaboration lockup, in the position occupied by JSTOR in the reference.
        pdf.setStrokeColor(HexColor("#d2d2d2"))
        pdf.line(LEFT, 151, RIGHT, 151)
        pdf.drawImage(
            ImageReader(whitestone_png), LEFT, 55, 82, 82, preserveAspectRatio=True, anchor="c", mask="auto"
        )
        pdf.setFillColor(black)
        pdf.setFont("Times-Bold", 12)
        pdf.drawString(144, 112, "WHITESTONE PUBLICATIONS")
        pdf.setFont("Times-Roman", 9.5)
        pdf.drawString(144, 94, "Publisher of the Journal for Cultural and Religious Theory")
        pdf.setFillColor(MUTED)
        pdf.setFont("Times-Roman", 8.5)
        pdf.drawCentredString(PAGE[0] / 2, 27, "jcrt.org  |  ISSN 1530-5228")

        pdf.showPage()
        pdf.save()

    assert output.read_bytes().startswith(b"%PDF-") and output.stat().st_size > 10_000


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", choices=("Article", "Review"), default="Article")
    parser.add_argument("--title", default="[Title]")
    parser.add_argument("--author", action="append", default=None, help="Repeat for multiple authors")
    parser.add_argument("--stable-url", default="https://jcrt.org/[permalink-or-doi]")
    parser.add_argument("--output", default=str(ROOT / "output/pdf/jcrt-flyleaf-template.pdf"))
    args = parser.parse_args()
    args.author = args.author or ["[Author name(s)]"]
    return args


if __name__ == "__main__":
    build(parse_args())
