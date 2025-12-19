from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
from ..storage import load_menu
from .base import safe_font, safe_open_image

BASE_DIR = Path(__file__).parents[1]
ASSETS_DIR = BASE_DIR / "data" / "assets"
FONTS_DIR = BASE_DIR / "fonts"

# 布局常量
CANVAS_WIDTH = 1000
PADDING_X = 40
GROUP_GAP = 30  # 分组之间的垂直间距
ITEM_H = 100  # 单个功能项高度
COLUMNS = 3  # 3列布局
ITEM_GAP_X = 15  # 功能项水平间距
ITEM_GAP_Y = 15  # 功能项垂直间距


def render_menu(save_path: Path):
    data = load_menu()

    # 1. 预计算总高度
    current_y = 350  # 头部留空 (标题区域)

    # 计算内容区域高度
    for group in data.get("groups", []):
        current_y += 60  # 分组标题高度
        items_count = len(group.get("items", []))
        rows = (items_count + COLUMNS - 1) // COLUMNS
        if rows == 0: rows = 1

        group_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 40  # 40是组内padding
        current_y += group_h + GROUP_GAP

    total_height = current_y + 50  # 底部留空

    # 2. 创建画布
    canvas = Image.new("RGBA", (CANVAS_WIDTH, total_height), (30, 30, 30, 255))

    # 3. 绘制背景
    bg_name = data.get("background", "")
    bg_path = ASSETS_DIR / "backgrounds" / bg_name
    if bg_name and bg_path.exists():
        bg = Image.open(bg_path).convert("RGBA")
        # 居中裁剪填充
        ratio = max(CANVAS_WIDTH / bg.width, total_height / bg.height)
        bg = bg.resize((int(bg.width * ratio), int(bg.height * ratio)))
        # 裁剪中心
        left = (bg.width - CANVAS_WIDTH) // 2
        top = (bg.height - total_height) // 2
        bg = bg.crop((left, top, left + CANVAS_WIDTH, top + total_height))
        # 模糊处理
        bg = bg.filter(ImageFilter.GaussianBlur(3))
        canvas.paste(bg, (0, 0))

    draw = ImageDraw.Draw(canvas)

    # 字体加载 (请确保 fonts 目录下有 title.ttf 和 text.ttf)
    font_main = safe_font(FONTS_DIR / "title.ttf", 70)  # 主标题
    font_sub = safe_font(FONTS_DIR / "title.ttf", 35)  # 副标题
    font_grp = safe_font(FONTS_DIR / "text.ttf", 32)  # 分组标题
    font_item = safe_font(FONTS_DIR / "title.ttf", 28)  # 项名称
    font_desc = safe_font(FONTS_DIR / "text.ttf", 18)  # 项描述

    # 4. 绘制头部
    draw.text((50, 80), data.get("title", "帮助"), font=font_main, fill=data.get("title_color", "#fff"))
    draw.text((50, 170), data.get("sub_title", "描述"), font=font_sub, fill="#ddd")

    # 5. 绘制分组
    cursor_y = 280

    item_width = (CANVAS_WIDTH - 2 * PADDING_X - (COLUMNS - 1) * ITEM_GAP_X) // COLUMNS

    for group in data.get("groups", []):
        # 绘制分组标题
        draw.text((PADDING_X + 10, cursor_y), group.get("title", "分组"), font=font_grp, fill="#eee")
        cursor_y += 50

        # 计算该组背景高度
        items = group.get("items", [])
        rows = (len(items) + COLUMNS - 1) // COLUMNS
        if rows == 0: rows = 1
        box_height = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 30

        # 绘制半透明黑底框
        draw.rounded_rectangle(
            (PADDING_X, cursor_y, CANVAS_WIDTH - PADDING_X, cursor_y + box_height),
            radius=15,
            fill=(0, 0, 0, 120)  # 半透明黑色
        )

        # 绘制每一个Item
        start_item_y = cursor_y + 15
        for i, item in enumerate(items):
            row = i // COLUMNS
            col = i % COLUMNS

            x = PADDING_X + 15 + col * (item_width + ITEM_GAP_X)
            y = start_item_y + row * (ITEM_H + ITEM_GAP_Y)

            # 图标
            icon_name = item.get("icon", "")
            if icon_name:
                icon = safe_open_image(ASSETS_DIR / "icons" / icon_name, (60, 60))
                canvas.paste(icon, (x, y + 10), icon)

            # 文字
            text_x = x + 75
            draw.text((text_x, y + 15), item.get("name", ""), font=font_item, fill="#fff")
            draw.text((text_x, y + 55), item.get("desc", ""), font=font_desc, fill="#aaa")

        cursor_y += box_height + GROUP_GAP

    canvas.save(save_path)