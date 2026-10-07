#for the filler, called in the /Tx branch once /V is set: fit_text_to_widget(field, value, writer)

import math
import re

from pypdf.generic import NameObject, TextStringObject

#smallest size a value is shrunk to, anything longer still clips at this size
MIN_FONT_SIZE = 6

#acrobat spaces multiline text at about 1.15 times the size, a little extra covers other viewers
LINE_HEIGHT = 1.2

#helvetica widths for ascii 32 to 126, in thousandths of the font size
#arial has the same metrics, so this covers the arial standard too
HELVETICA_WIDTHS = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

#the font name and size inside a /DA string like "0 g /Helv 10 Tf"
DA_FONT = re.compile(r"(/[^\s/]+)\s+([0-9.]+)\s+Tf")

FLAG_MULTILINE = 1 << 12
FLAG_COMB      = 1 << 24


def get_inherited(node, key):
    #da and ff can sit on the widget, a parent field node, or neither
    guard = 0
    while node is not None and guard < 64:
        if key in node:
            return node[key]
        parent = node.get("/Parent")
        node = parent.get_object() if parent else None
        guard += 1
    return None


def get_char_widths(font_name, acroform):
    #the font's own /Widths when it has them, acrobat's arial usually does
    #standard fonts carry none, courier is fixed width and the rest measure as helvetica
    font = {}
    resources = acroform.get("/DR")
    if resources is not None:
        fonts = resources.get_object().get("/Font")
        if fonts is not None and font_name in fonts.get_object():
            font = fonts.get_object()[font_name]

    if "/Widths" in font:
        first_char = int(font.get("/FirstChar", 0))
        return {first_char + i: float(w) for i, w in enumerate(font["/Widths"])}
    if "courier" in str(font.get("/BaseFont", font_name)).lower():
        return {code: 600 for code in range(32, 127)}
    return {32 + i: w for i, w in enumerate(HELVETICA_WIDTHS)}


def text_width(text, size, widths):
    #anything outside the table counts as a digit
    return sum(widths.get(ord(ch), 556) for ch in text) * size / 1000


def count_lines(value, size, width, widths):
    #word wrap the way viewers do it, a word wider than the box breaks by character
    lines = 0
    for paragraph in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        lines += 1
        line = ""
        for word in paragraph.split(" "):
            candidate = word if not line else line + " " + word
            if text_width(candidate, size, widths) <= width:
                line = candidate
                continue
            if line:
                lines += 1
            line = ""
            for ch in word:
                if line and text_width(line + ch, size, widths) > width:
                    lines += 1
                    line = ""
                line += ch
    return lines


def fits(value, size, width, height, widths, multiline):
    if multiline:
        return count_lines(value, size, width, widths) * size * LINE_HEIGHT <= height
    return text_width(value, size, widths) <= width


def fit_text_to_widget(widget, value, writer):
    #shrinks the widget's font until the value fits, never above the size the form was designed with
    #auto size fields (0) are left to the viewer
    if not value:
        return
    acroform = writer.root_object["/AcroForm"]
    da = get_inherited(widget, "/DA")
    da = str(da if da is not None else acroform.get("/DA", ""))
    match = DA_FONT.search(da)
    if not match:
        return
    font_name, designed_size = match.group(1), float(match.group(2))
    if designed_size <= 0:
        return

    flags = int(get_inherited(widget, "/Ff") or 0)
    if flags & FLAG_COMB:
        return

    #the room for text inside the widget, a 2pt margin plus the border off each side
    x1, y1, x2, y2 = [float(v) for v in widget["/Rect"]]
    width, height = abs(x2 - x1), abs(y2 - y1)
    mk = widget.get("/MK")
    if mk is not None and int(mk.get_object().get("/R", 0)) % 180 == 90:
        width, height = height, width
    bs = widget.get("/BS")
    border = float(bs.get_object().get("/W", 1)) if bs is not None else 1
    width -= 2 * (2 + border)
    height -= 2 * (2 + border)

    widths = get_char_widths(font_name, acroform)
    multiline = bool(flags & FLAG_MULTILINE)
    size = designed_size
    while size > MIN_FONT_SIZE and not fits(value, size, width, height, widths, multiline):
        #down in half points
        size = max(MIN_FONT_SIZE, (math.ceil(size * 2) - 1) / 2)

    if size < designed_size:
        new_size = f"{size:g}"
        widget[NameObject("/DA")] = TextStringObject(da[:match.start(2)] + new_size + da[match.end(2):])
