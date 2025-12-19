from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path
from ..storage import load_menu

# --- 常量定义 ---
BASE_DIR = Path(__file__).parents[1]
ASSETS_DIR = BASE_DIR / "data" / "assets"
FONTS_DIR = BASE_DIR / "fonts"

CANVAS_WIDTH = 1000
PADDING_X = 40
GROUP_GAP = 30
ITEM_H = 100
ITEM_GAP_X = 15
ITEM_GAP_Y = 15


def load_font(font_name: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(FONTS_DIR / font_name), int(size))
    except Exception:
        return ImageFont.load_default()


def render_menu(save_path: Path):
    """主渲染函数"""
    data = load_menu()

    # --- 1. 读取配置 ---
    columns = int(data.get("layout_columns") or 3)
    columns = max(1, columns)

    # 颜色
    colors = {
        "title": data.get("title_color") or "#FFFFFF",
        "sub": data.get("subtitle_color") or "#DDDDDD",
        "group": data.get("group_title_color") or "#FFFFFF",
        "name": data.get("item_name_color") or "#FFFFFF",
        "desc": data.get("item_desc_color") or "#AAAAAA",
        "text": data.get("text_color") or "#FFFFFF"
    }

    # 字体与字号
    t_font_file = data.get("title_font") or "title.ttf"
    txt_font_file = data.get("text_font") or "text.ttf"

    sizes = {
        "title": int(data.get("title_size") or 60),
        "group": int(data.get("group_title_size") or 30),
        "name": int(data.get("item_name_size") or 26),
        "desc": int(data.get("item_desc_size") or 16)
    }

    fonts = {
        "main": load_font(t_font_file, sizes["title"]),
        "sub": load_font(t_font_file, int(sizes["title"] * 0.5)),
        "group": load_font(txt_font_file, sizes["group"]),
        "name": load_font(t_font_file, sizes["name"]),
        "desc": load_font(txt_font_file, sizes["desc"])
    }

    # --- 2. 计算内容高度 ---
    header_height = 80 + sizes["title"] + 20 + int(sizes["title"] * 0.5) + 60
    current_y = header_height

    groups = data.get("groups", []) or []
    for group in groups:
        current_y += 60
        items = group.get("items", []) or []
        if items:
            rows = (len(items) + columns - 1) // columns
            group_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 40
        else:
            group_h = 0
        current_y += group_h + GROUP_GAP

    content_bottom = current_y + 50

    # 组件高度
    widgets_bottom = 0
    for w in data.get("custom_widgets", []) or []:
        try:
            w_bottom = int(w.get("y", 0)) + int(w.get("size", 40)) + 50
            widgets_bottom = max(widgets_bottom, w_bottom)
        except:
            pass

    # --- 3. 计算背景图高度 (核心修改：完整显示) ---
    bg_height_scaled = 0
    bg_name = data.get("background", "")
    bg_path = ASSETS_DIR / "backgrounds" / bg_name
    bg_img = None

    if bg_name and bg_path.exists():
        try:
            bg_img = Image.open(bg_path).convert("RGBA")
            # 强制宽度 1000，高度按比例缩放，不裁剪
            scale_ratio = CANVAS_WIDTH / bg_img.width
            bg_height_scaled = int(bg_img.height * scale_ratio)
        except:
            pass

    # 最终高度：取 背景图高度 和 内容高度 的最大值
    # 这样如果背景图很长，画布就自动变长；如果内容很多，画布也能包住内容
    total_height = max(content_bottom, widgets_bottom, bg_height_scaled, 800)

    # --- 4. 绘制 ---
    base = Image.new("RGBA", (CANVAS_WIDTH, total_height), (30, 30, 30, 255))

    if bg_img:
        try:
            # 重新缩放 (Width=1000, Height=Auto)
            new_w = CANVAS_WIDTH
            new_h = int(bg_img.height * (CANVAS_WIDTH / bg_img.width))
            bg_resized = bg_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

            # 高斯模糊一下背景 (可选，如果不想模糊可以注释掉下面这行)
            # bg_resized = bg_resized.filter(ImageFilter.GaussianBlur(2))

            base.paste(bg_resized, (0, 0))
        except Exception as e:
            print(f"BG Render Error: {e}")

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)

    # 绘制头部
    align = data.get("title_align", "center")

    def draw_text_aligned(text, y, font, color):
        try:
            w = font.getlength(text)
        except:
            w = 200
        if align == "left":
            x = 50
        elif align == "right":
            x = CANVAS_WIDTH - 50 - w
        else:
            x = (CANVAS_WIDTH - w) / 2
        draw_ov.text((x, y), text, font=font, fill=color)

    title_y = 80
    sub_y = title_y + sizes["title"] + 20
    draw_text_aligned(data.get("title", ""), title_y, fonts["main"], colors["title"])
    draw_text_aligned(data.get("sub_title", ""), sub_y, fonts["sub"], colors["sub"])

    # 绘制列表
    cursor_y = header_height
    item_width = (CANVAS_WIDTH - 2 * PADDING_X - (columns - 1) * ITEM_GAP_X) // columns

    for group in groups:
        title = group.get("title", "分组")
        draw_ov.text((PADDING_X + 10, cursor_y), title, font=fonts["group"], fill=colors["group"])
        cursor_y += 50

        items = group.get("items", []) or []
        if not items:
            cursor_y += GROUP_GAP
            continue

        rows = (len(items) + columns - 1) // columns
        box_height = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 30

        draw_ov.rounded_rectangle(
            (PADDING_X, cursor_y, CANVAS_WIDTH - PADDING_X, cursor_y + box_height),
            radius=15, fill=(0, 0, 0, 120)
        )

        start_item_y = cursor_y + 15
        for i, item in enumerate(items):
            row = i // columns
            col = i % columns
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
                draw_ov.text((text_x, y + 15), item.get("name", ""), font=fonts["name"], fill=colors["name"])
                draw_ov.text((text_x, y + 55), item.get("desc", ""), font=fonts["desc"], fill=colors["desc"])
            else:
                name_text = item.get("name", "")
                desc_text = item.get("desc", "")
                try:
                    nw = fonts["name"].getlength(name_text)
                    dw = fonts["desc"].getlength(desc_text)
                except:
                    nw, dw = 100, 100

                content_w = item_width - 30
                nx = x + (content_w - nw) / 2
                dx = x + (content_w - dw) / 2

                draw_ov.text((nx, y + 15), name_text, font=fonts["name"], fill=colors["name"])
                draw_ov.text((dx, y + 55), desc_text, font=fonts["desc"], fill=colors["desc"])

        cursor_y += box_height + GROUP_GAP

    # 绘制组件
    for wid in data.get("custom_widgets", []) or []:
        try:
            w_text = wid.get("text", "Text")
            w_x = int(wid.get("x", 0))
            w_y = int(wid.get("y", 0))
            w_size = int(wid.get("size", 40))
            w_color = wid.get("color", "#FFFFFF")
            w_font_name = wid.get("font", t_font_file)
            w_font = load_font(w_font_name, w_size)
            draw_ov.text((w_x, w_y), w_text, font=w_font, fill=w_color)
        except:
            pass

    result = Image.alpha_composite(base, overlay)
    result.save(save_path)