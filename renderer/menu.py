from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path
from ..storage import ASSETS_DIR, FONTS_DIR

# --- 常量定义 ---
DEFAULT_WIDTH = 1000
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


def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    return (30, 30, 30)


def draw_glass_rect(base_img: Image.Image, box: tuple, color_hex: str, alpha: int, radius: int, corner_r=15):
    """绘制毛玻璃矩形"""
    x1, y1, x2, y2 = map(int, box)
    w, h = x2 - x1, y2 - y1
    if w <= 0 or h <= 0: return

    img_w, img_h = base_img.size
    x1 = max(0, x1);
    y1 = max(0, y1);
    x2 = min(img_w, x2);
    y2 = min(img_h, y2)

    crop = base_img.crop((x1, y1, x2, y2))
    if radius > 0:
        crop = crop.filter(ImageFilter.GaussianBlur(radius))
        base_img.paste(crop, (x1, y1))

    overlay = Image.new("RGBA", base_img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    rgb = hex_to_rgb(color_hex)
    draw.rounded_rectangle((x1, y1, x2, y2), radius=corner_r, fill=rgb + (int(alpha),))
    base_img.alpha_composite(overlay)


def draw_text_fit(draw, text, box, font_obj, max_size, color, align='center'):
    """自适应文字"""
    center_x, top_y, max_w, max_h = box

    # 获取字体对象的文件路径重新加载以调整大小
    try:
        font_path = font_obj.path
        font = ImageFont.truetype(font_path, int(max_size))
    except:
        font = font_obj

    current_size = max_size
    # 尝试缩小
    while current_size > 10:
        length = font.getlength(text)
        if length <= max_w - 4:
            break
        current_size -= 2
        try:
            font = ImageFont.truetype(font_path, int(current_size))
        except:
            pass

    w = font.getlength(text)
    if align == 'center':
        draw_x = center_x - w / 2
    elif align == 'left':
        draw_x = center_x - max_w / 2
    else:
        draw_x = center_x

    draw.text((draw_x, top_y), text, font=font, fill=color)


def render_one_menu(menu_data: dict) -> Image.Image:
    # --- 1. 配置读取 ---
    use_canvas_size = menu_data.get("use_canvas_size", False)
    canvas_w_set = int(menu_data.get("canvas_width", 1000))
    canvas_h_set = int(menu_data.get("canvas_height", 2000))
    padding_margin = int(menu_data.get("canvas_padding", 40))
    canvas_color_hex = menu_data.get("canvas_color", "#1e1e1e")

    calc_width = canvas_w_set if use_canvas_size else 1000
    columns = int(menu_data.get("layout_columns") or 3)
    columns = max(1, columns)

    # 颜色
    colors = {
        "title": menu_data.get("title_color", "#FFF"),
        "sub": menu_data.get("subtitle_color", "#DDD"),
        "group": menu_data.get("group_title_color", "#FFF"),
        "group_sub": menu_data.get("group_sub_color", "#AAA"),
        "name": menu_data.get("item_name_color", "#FFF"),
        "desc": menu_data.get("item_desc_color", "#AAA"),
    }

    # 字体文件
    f_title = menu_data.get("title_font") or "title.ttf"
    f_group = menu_data.get("group_title_font") or "text.ttf"
    f_gsub = menu_data.get("group_sub_font") or "text.ttf"
    f_name = menu_data.get("item_name_font") or "title.ttf"
    f_desc = menu_data.get("item_desc_font") or "text.ttf"

    # 字号
    sizes = {
        "title": int(menu_data.get("title_size") or 60),
        "group": int(menu_data.get("group_title_size") or 30),
        "group_sub": int(menu_data.get("group_sub_size") or 18),
        "name": int(menu_data.get("item_name_size") or 26),
        "desc": int(menu_data.get("item_desc_size") or 16)
    }

    # 加载字体对象
    fonts = {
        "main": load_font(f_title, sizes["title"]),
        "sub": load_font(f_title, int(sizes["title"] * 0.5)),
        "group": load_font(f_group, sizes["group"]),
        "group_sub": load_font(f_gsub, sizes["group_sub"]),
        "name": load_font(f_name, sizes["name"]),
        "desc": load_font(f_desc, sizes["desc"])
    }

    # --- 2. 布局计算 ---
    header_top_padding = 80
    header_height = header_top_padding + sizes["title"] + 20 + int(sizes["title"] * 0.5) + 40
    current_y = header_height

    groups = menu_data.get("groups", []) or []
    group_layout_info = []

    for group in groups:
        # 标题区高度固定一点，因为是横向排列
        g_title_h = 50

        current_y += g_title_h
        items = group.get("items", []) or []

        start_box_y = current_y
        group_h = 0

        if items:
            rows = (len(items) + columns - 1) // columns
            group_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + 40

        group_layout_info.append({
            "data": group,
            "y_title": current_y - g_title_h,
            "y_box": start_box_y,
            "h_box": group_h
        })
        current_y += group_h + GROUP_GAP

    content_bottom = current_y + 20

    # 组件计算
    widgets = menu_data.get("custom_widgets", []) or []
    if widgets:
        max_wid_bottom = 0
        for w in widgets:
            y = int(w.get('y', 0))
            h = int(w.get('height', 0)) if w.get('type') == 'image' else int(w.get('size', 40))
            if y + h > max_wid_bottom: max_wid_bottom = y + h
        content_bottom = max(content_bottom, max_wid_bottom)

    # 画布尺寸
    if use_canvas_size:
        final_w, final_h = canvas_w_set, canvas_h_set
    else:
        final_w = calc_width
        final_h = content_bottom + padding_margin

    # --- 3. 绘制 ---
    bg_color_rgb = hex_to_rgb(canvas_color_hex)
    base = Image.new("RGBA", (final_w, final_h), bg_color_rgb + (255,))

    # 背景图
    bg_name = menu_data.get("background", "")
    if bg_name:
        bg_path = ASSETS_DIR / "backgrounds" / bg_name
        if bg_path.exists():
            try:
                bg_img = Image.open(bg_path).convert("RGBA")
                fit_mode = menu_data.get("bg_fit_mode", "cover_w")
                align_x = menu_data.get("bg_align_x", "center")
                align_y = menu_data.get("bg_align_y", "top")

                if fit_mode == "custom":
                    t_w = int(menu_data.get("bg_custom_width", 1000))
                    t_h = int(menu_data.get("bg_custom_height", 1000))
                else:
                    scale = final_w / bg_img.width
                    t_w = final_w
                    t_h = int(bg_img.height * scale)

                if t_w > 0 and t_h > 0:
                    bg_resized = bg_img.resize((t_w, t_h), Image.Resampling.LANCZOS)
                    px = (final_w - t_w) // 2 if align_x == "center" else (final_w - t_w if align_x == "right" else 0)
                    py = (final_h - t_h) // 2 if align_y == "center" else (final_h - t_h if align_y == "bottom" else 0)
                    base.paste(bg_resized, (px, py), bg_resized)
            except:
                pass

    # 毛玻璃
    box_color = menu_data.get("box_bg_color") or "#000000"
    box_alpha = int(menu_data.get("box_bg_alpha", 120))
    box_blur = int(menu_data.get("box_blur_radius", 0))
    for g_info in group_layout_info:
        if g_info["h_box"] > 0:
            box = (PADDING_X, g_info["y_box"], final_w - PADDING_X, g_info["y_box"] + g_info["h_box"])
            draw_glass_rect(base, box, box_color, box_alpha, box_blur)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)

    # 头部标题
    align = menu_data.get("title_align", "center")

    def get_x_by_align(text, font):
        w = font.getlength(text)
        if align == 'left': return 50
        if align == 'right': return final_w - 50 - w
        return (final_w - w) / 2

    title_text = menu_data.get("title", "")
    sub_text = menu_data.get("sub_title", "")
    draw_ov.text((get_x_by_align(title_text, fonts["main"]), 80), title_text, font=fonts["main"], fill=colors["title"])
    draw_ov.text((get_x_by_align(sub_text, fonts["sub"]), 80 + sizes["title"] + 10), sub_text, font=fonts["sub"],
                 fill=colors["sub"])

    # 分组内容
    item_width = (final_w - 2 * PADDING_X - (columns - 1) * ITEM_GAP_X) // columns

    for g_info in group_layout_info:
        group = g_info["data"]
        g_title_y = g_info["y_title"]

        # --- 横向绘制分组标题和副标题 ---
        g_title = group.get("title", "")
        g_sub = group.get("subtitle", "")

        # 绘制主标题
        draw_ov.text((PADDING_X + 10, g_title_y), g_title, font=fonts["group"], fill=colors["group"])

        # 绘制副标题 (紧跟主标题右侧)
        if g_sub:
            title_w = fonts["group"].getlength(g_title)
            # 基线对齐调整：简单估算，让副标题底部与标题对齐
            sub_x = PADDING_X + 10 + title_w + 15
            # 这里的 y 坐标可能需要微调来实现底部对齐，这里简单加一点偏移
            sub_y = g_title_y + (sizes["group"] - sizes["group_sub"]) - 2
            draw_ov.text((sub_x, sub_y), g_sub, font=fonts["group_sub"], fill=colors["group_sub"])

        items = group.get("items", []) or []
        if not items: continue

        start_item_y = g_info["y_box"] + 20
        for i, item in enumerate(items):
            row = i // columns
            col = i % columns
            x = PADDING_X + 20 + col * (item_width + ITEM_GAP_X)
            y = start_item_y + row * (ITEM_H + ITEM_GAP_Y)

            content_w = item_width - 40
            center_x = x + content_w / 2

            icon_name = item.get("icon", "")
            icon_path = ASSETS_DIR / "icons" / icon_name

            has_icon = False
            if icon_name and icon_path.exists():
                try:
                    icon = Image.open(icon_path).convert("RGBA")
                    icon = icon.resize((60, 60), Image.Resampling.LANCZOS)
                    overlay.paste(icon, (x, y + 20), icon)
                    has_icon = True
                except:
                    pass

            name_txt = item.get("name", "")
            desc_txt = item.get("desc", "")

            if has_icon:
                text_start_x = x + 75
                text_max_w = item_width - 40 - 75
                text_center_x = text_start_x + text_max_w / 2
                draw_text_fit(draw_ov, name_txt, (text_center_x, y + 20, text_max_w, 30), fonts["name"], sizes["name"],
                              colors["name"], align='left')
                draw_text_fit(draw_ov, desc_txt, (text_center_x, y + 55, text_max_w, 20), fonts["desc"], sizes["desc"],
                              colors["desc"], align='left')
            else:
                draw_text_fit(draw_ov, name_txt, (center_x, y + 20, content_w, 30), fonts["name"], sizes["name"],
                              colors["name"], align='center')
                draw_text_fit(draw_ov, desc_txt, (center_x, y + 55, content_w, 20), fonts["desc"], sizes["desc"],
                              colors["desc"], align='center')

    # 自定义组件
    for wid in menu_data.get("custom_widgets", []) or []:
        try:
            w_x = int(wid.get("x", 0))
            w_y = int(wid.get("y", 0))
            if wid.get("type") == "image":
                img_name = wid.get("content", "")
                img_path = ASSETS_DIR / "widgets" / img_name
                w_w = int(wid.get("width", 100))
                w_h = int(wid.get("height", 100))
                if img_name and img_path.exists():
                    w_img = Image.open(img_path).convert("RGBA")
                    w_img = w_img.resize((w_w, w_h), Image.Resampling.LANCZOS)
                    overlay.paste(w_img, (w_x, w_y), w_img)
            else:
                w_text = wid.get("text", "Text")
                w_size = int(wid.get("size", 40))
                w_color = wid.get("color", "#FFFFFF")
                # 简单处理，这里没做详细字体映射，默认用title
                f_w = load_font(f_title, w_size)
                draw_ov.text((w_x, w_y), w_text, font=f_w, fill=w_color)
        except:
            pass

    return Image.alpha_composite(base, overlay)