import json
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("/tmp/XiaoColour-Data-e2e.json")
OUTPUT = ROOT / "output" / "pdf" / "XiaoColour-Life-Archive-Test-2026-10-27.pdf"
FONT = "/System/Library/Fonts/STHeiti Medium.ttc"

CREAM = HexColor("#FBF8F0")
PAPER = HexColor("#FFFDF8")
SAGE = HexColor("#738B7B")
SAGE_DARK = HexColor("#526D59")
SAGE_SOFT = HexColor("#E8EEE7")
PEACH = HexColor("#F5E9E2")
INK = HexColor("#252B28")
MUTED = HexColor("#768078")
LINE = HexColor("#E4E7DF")


def setup_font():
    pdfmetrics.registerFont(TTFont("XiaoCJK", FONT, subfontIndex=0))


def background(c):
    c.setFillColor(CREAM)
    c.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)


def header(c, title, label, page):
    background(c)
    c.setFillColor(SAGE_DARK)
    c.setFont("XiaoCJK", 11)
    c.drawString(42, 807, "XiaoColour")
    c.setFillColor(SAGE)
    c.setFont("XiaoCJK", 8)
    c.drawString(42, 773, label)
    c.setFillColor(INK)
    c.setFont("XiaoCJK", 24)
    c.drawString(42, 735, title)
    c.setStrokeColor(LINE)
    c.line(42, 720, 553, 720)
    c.setFillColor(MUTED)
    c.setFont("XiaoCJK", 8)
    c.drawRightString(553, 32, str(page))


def card(c, x, y, w, h, fill):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, w, h, 12, stroke=1, fill=1)


def main():
    setup_font()
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    tasks = data.get("data", {}).get("myDays", [])
    important = data.get("data", {}).get("importantDates", [])
    footprints = data.get("data", {}).get("footprints", [])
    completed = sum(1 for item in tasks if item.get("completed"))
    visited = sum(1 for item in footprints if item.get("status") == "visited")
    wished = sum(1 for item in footprints if item.get("status") == "wish")
    countries = len({item.get("countryCode") for item in footprints if item.get("countryCode")})

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("XiaoColour My Life Archive - Test")

    background(c)
    c.setFillColor(SAGE_DARK)
    c.setFont("XiaoCJK", 15)
    c.drawString(48, 790, "XiaoColour")
    c.setFont("XiaoCJK", 34)
    c.drawString(48, 585, "My Life Archive")
    c.setFillColor(INK)
    c.setFont("XiaoCJK", 36)
    c.drawString(48, 520, "我的生活档案")
    c.setFillColor(MUTED)
    c.setFont("XiaoCJK", 15)
    c.drawString(50, 475, "走过的地方，都是生活的颜色。")
    card(c, 48, 155, 499, 105, PEACH)
    c.setFillColor(INK)
    c.setFont("XiaoCJK", 13)
    c.drawString(70, 215, "记录范围：全部记录")
    c.setFillColor(MUTED)
    c.setFont("XiaoCJK", 10)
    c.drawString(70, 185, "导出日期：2026 年 10 月 27 日 · 本地测试账户")
    c.showPage()

    header(c, "生活概览", "LIFE OVERVIEW", 2)
    stats = [(len(tasks), "已记录任务"), (completed, "已完成任务"), (len(important), "重要日期"), (visited, "去过的地点"), (wished, "想去的地点"), (countries, "国家或地区")]
    for index, (value, label) in enumerate(stats):
        col, row = index % 3, index // 3
        x, y = 42 + col * 174, 555 - row * 130
        card(c, x, y, 154, 102, SAGE_SOFT if index not in (2, 4) else PEACH)
        c.setFillColor(SAGE_DARK)
        c.setFont("XiaoCJK", 25)
        c.drawString(x + 18, y + 54, str(value))
        c.setFillColor(MUTED)
        c.setFont("XiaoCJK", 10)
        c.drawString(x + 18, y + 25, label)
    c.showPage()

    header(c, "我的日程", "MY DAYS", 3)
    records = sorted([dict(item, kind="task") for item in tasks] + [dict(item, kind="important") for item in important], key=lambda item: item.get("date", ""))[:10]
    if not records:
        c.setFillColor(MUTED); c.setFont("XiaoCJK", 14); c.drawCentredString(297, 600, "这个时间范围内还没有日程记录。")
    for index, item in enumerate(records):
        y = 665 - index * 55
        card(c, 42, y, 511, 42, PAPER if index % 2 else SAGE_SOFT)
        c.setFillColor(MUTED); c.setFont("XiaoCJK", 9); c.drawString(56, y + 16, item.get("date", "—"))
        c.setFillColor(INK); c.setFont("XiaoCJK", 10); c.drawString(160, y + 16, ("重要日期 · " if item["kind"] == "important" else "") + item.get("title", ""))
    c.showPage()

    header(c, "旅行足迹", "FOOTPRINTS", 4)
    if not footprints:
        c.setFillColor(MUTED); c.setFont("XiaoCJK", 14); c.drawCentredString(297, 600, "这个时间范围内还没有旅行足迹。")
    else:
        place = footprints[0]
        card(c, 42, 390, 511, 270, PAPER)
        c.setFillColor(INK); c.setFont("XiaoCJK", 22); c.drawString(64, 615, place.get("nameZh") or place.get("name") or "未命名地点")
        c.setFillColor(MUTED); c.setFont("XiaoCJK", 10); c.drawString(64, 588, " · ".join(filter(None, [place.get("nameEn"), place.get("countryCode")])))
        c.setFillColor(SAGE_DARK); c.setFont("XiaoCJK", 11); c.drawString(64, 548, "去过" if place.get("status") == "visited" else "想去")
        c.setFillColor(INK); c.setFont("XiaoCJK", 11); c.drawString(64, 510, place.get("note") or "这条足迹还没有添加文字备注。")
        card(c, 64, 420, 467, 62, PEACH)
        c.setFillColor(MUTED); c.setFont("XiaoCJK", 9); c.drawString(82, 448, "测试照片已通过鉴权读取；生产 PDF 使用用户实际保存的照片。")
    c.showPage()

    background(c)
    c.setFillColor(SAGE)
    c.setFont("XiaoCJK", 40)
    c.drawCentredString(297, 560, "“")
    c.setFillColor(INK)
    c.setFont("XiaoCJK", 21)
    c.drawCentredString(297, 485, "每一段平凡的日子，")
    c.drawCentredString(297, 447, "都值得被认真收藏。")
    c.setFillColor(SAGE_DARK)
    c.setFont("XiaoCJK", 12)
    c.drawCentredString(297, 330, "XiaoColour · My Little World")
    c.setFillColor(MUTED); c.setFont("XiaoCJK", 8); c.drawRightString(553, 32, "5")
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
