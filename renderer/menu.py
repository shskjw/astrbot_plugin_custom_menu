from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path
from ..storage import load_menu

BASE_DIR = Path(__file__).parents[1]
ASSETS_DIR = BASE_DIR / "data" / "assets"
FONTS_DIR = BASE_DIR / "fonts"

CANVAS_WIDTH = 1000
PADDING_X = 40
GROUP_GAP = 30
ITEM_H = 100
COLUMNS = 3
ITEM_GAP_X = 15
ITEM_GAP_Y = 15


def safe_font(path, size):
    try:
        return ImageFont.truetype(str(path), size)
    except:
        return ImageFont.load_default()


def render_menu(save_path: Path):
    data = load_menu()

    title_color = data.get("title_color", "#FFFFFF")
    text_color = data.get("text_color", "#FFFFFF")

    # 获取字体配置
    # 默认兜底 title.ttf 和 text.ttf (如果存在)
    t_font_file = data.get("title_font", "title.ttf")
    txt_font_file = data.get("text_font", "text.ttf")

    current_y = 350
    for group in data.get("groups", []):
        current_y += 60
        items_count = len(group.get("items", []))
        if items_count > 0:
            rows = (items_count + COLUMNS - 1) // COLUMNS
            group_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 40
        else:
            group_h = 0
        current_y += group_h + GROUP_GAP
    total_height = current_y + 50

    base = Image.new("RGBA", (CANVAS_WIDTH, total_height), (30, 30, 30, 255))

    bg_name = data.get("background", "")
    bg_path = ASSETS_DIR / "backgrounds" / bg_name
    if bg_name and bg_path.exists():
        try:
            bg = Image.open(bg_path).convert("RGBA")
            ratio = max(CANVAS_WIDTH / bg.width, total_height / bg.height)
            bg = bg.resize((int(bg.width * ratio), int(bg.height * ratio)), Image.Resampling.LANCZOS)
            left = (bg.width - CANVAS_WIDTH) // 2
            top = (bg.height - total_height) // 2
            bg = bg.crop((left, top, left + CANVAS_WIDTH, top + total_height))
            bg = bg.filter(ImageFilter.GaussianBlur(3))
            base.paste(bg, (0, 0))
        except:
            pass

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)

    # 加载动态字体
    font_main = safe_font(FONTS_DIR / t_font_file, 70)
    font_sub = safe_font(FONTS_DIR / txt_font_file, 35)
    font_grp = safe_font(FONTS_DIR / txt_font_file, 32)
    font_item = safe_font(FONTS_DIR / t_font_file, 28)
    font_desc = safe_font(FONTS_DIR / txt_font_file, 18)

    draw_ov.text((50, 80), data.get("title", "功能菜单"), font=font_main, fill=title_color)
    draw_ov.text((50, 170), data.get("sub_title", ""), font=font_sub, fill="#DDDDDD")

    cursor_y = 280
    item_width = (CANVAS_WIDTH - 2 * PADDING_X - (COLUMNS - 1) * ITEM_GAP_X) // COLUMNS

    for group in data.get("groups", []):
        title = group.get("title", "分组")
        draw_ov.text((PADDING_X + 10, cursor_y), title, font=font_grp, fill=text_color)

        cursor_y += 50
        items = group.get("items", [])
        if not items:
            cursor_y += GROUP_GAP
            continue

        rows = (len(items) + COLUMNS - 1) // COLUMNS
        box_height = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 30

        draw_ov.rounded_rectangle(
            (PADDING_X, cursor_y, CANVAS_WIDTH - PADDING_X, cursor_y + box_height),
            radius=15,
            fill=(0, 0, 0, 120)
        )

        start_item_y = cursor_y + 15
        for i, item in enumerate(items):
            row = i // COLUMNS
            col = i % COLUMNS
            x = PADDING_X + 15 + col * (item_width + ITEM_GAP_X)
            y = start_item_y + row * (ITEM_H + ITEM_GAP_Y)

            icon_name = item.get("icon", "")
            icon_path = ASSETS_DIR / "icons" / icon_name
            if icon_name and icon_path.exists():
                try:
                    icon = Image.open(icon_path).convert("RGBA")
                    icon = icon.resize((60, 60), Image.Resampling.LANCZOS)
                    overlay.paste(icon, (x, y + 10), icon)
                except:
                    pass

            text_x = x + 75
            draw_ov.text((text_x, y + 15), item.get("name", ""), font=font_item, fill=text_color)
            draw_ov.text((text_x, y + 55), item.get("desc", ""), font=font_desc, fill="#AAAAAA")

        cursor_y += box_height + GROUP_GAP

    result = Image.alpha_composite(base, overlay)
    result.save(save_path)