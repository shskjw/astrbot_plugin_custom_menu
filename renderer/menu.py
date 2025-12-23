import traceback
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path

# AstrBot API
try:
    from astrbot.api import logger
except ImportError:
    import logging

    logger = logging.getLogger(__name__)

# 引用 storage 单例
from ..storage import plugin_storage

# --- Constants ---
BASE_PADDING_X = 40
BASE_GROUP_GAP = 30
BASE_ITEM_H = 90
BASE_ITEM_GAP_X = 15
BASE_ITEM_GAP_Y = 15


def load_font(font_name: str, size: int) -> ImageFont.FreeTypeFont:
    # 字体路径现在从 plugin_storage.fonts_dir 获取 (指向 data/assets/fonts)
    if not font_name or not plugin_storage.fonts_dir:
        return ImageFont.load_default()

    font_path = plugin_storage.fonts_dir / font_name
    try:
        if font_path.exists():
            return ImageFont.truetype(str(font_path), int(size))
        return ImageFont.load_default()
    except Exception as e:
        logger.warning(f"Font load error ({font_name}): {e}")
        return ImageFont.load_default()


def hex_to_rgb(hex_color):
    hex_color = (hex_color or "#000000").lstrip('#')
    try:
        if len(hex_color) == 6:
            return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    except (ValueError, TypeError):
        return 30, 30, 30
    except Exception:
        return 30, 30, 30


def draw_text_with_shadow(draw, pos, text, font, fill, shadow_cfg, anchor=None, spacing=4, scale=1.0):
    x, y = pos
    if not text: return

    if shadow_cfg.get('enabled'):
        s_color = hex_to_rgb(shadow_cfg.get('color', '#000000'))
        off_x = int(shadow_cfg.get('offset_x', 2) * scale)
        off_y = int(shadow_cfg.get('offset_y', 2) * scale)
        radius = int(shadow_cfg.get('radius', 2) * scale)

        if radius > 0:
            try:
                # 标准 Pillow 写法
                bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing, anchor=anchor)
                w = max(1, bbox[2] - bbox[0] + radius * 4)
                h = max(1, bbox[3] - bbox[1] + radius * 4)

                shadow_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
                s_draw = ImageDraw.Draw(shadow_img)

                txt_x = radius * 2 - bbox[0]
                txt_y = radius * 2 - bbox[1]
                s_draw.multiline_text((txt_x, txt_y), text, font=font, fill=s_color + (160,), spacing=spacing)

                shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(radius))

                paste_x = x + off_x + bbox[0] - radius * 2
                paste_y = y + off_y + bbox[1] - radius * 2

                draw._image.paste(shadow_img, (int(paste_x), int(paste_y)), shadow_img)
            except Exception:
                # 异常降级
                draw.multiline_text((x + off_x, y + off_y), text, font=font, fill=s_color, anchor=anchor,
                                    spacing=spacing)
        else:
            draw.multiline_text((x + off_x, y + off_y), text, font=font, fill=s_color, anchor=anchor, spacing=spacing)

    draw.multiline_text((x, y), text, font=font, fill=fill, anchor=anchor, spacing=spacing)


def draw_glass_rect(base_img: Image.Image, box: tuple, color_hex: str, alpha: int, radius: int, corner_r=15):
    x1, y1, x2, y2 = map(int, box)
    if x2 - x1 <= 0 or y2 - y1 <= 0: return

    if radius > 0:
        try:
            crop = base_img.crop(box).filter(ImageFilter.GaussianBlur(radius))
            base_img.paste(crop, box)
        except Exception:
            pass

    overlay = Image.new("RGBA", base_img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle(box, radius=corner_r, fill=hex_to_rgb(color_hex) + (int(alpha),))
    base_img.alpha_composite(overlay)


def render_item_content(overlay_img, draw, item, box, fonts_map, shadow_cfg, scale):
    x, y, x2, y2 = box
    w, h = x2 - x, y2 - y

    icon_name = item.get("icon", "")
    text_start_x = x + int(15 * scale)

    if icon_name and plugin_storage.icon_dir:
        icon_path = plugin_storage.icon_dir / icon_name
        if icon_path.exists():
            try:
                with Image.open(icon_path).convert("RGBA") as icon_img:
                    custom_icon_size = item.get("icon_size")
                    if custom_icon_size and int(custom_icon_size) > 0:
                        target_h = int(int(custom_icon_size) * scale)
                    else:
                        target_h = int(h * 0.6)

                    aspect_ratio = icon_img.width / icon_img.height if icon_img.height > 0 else 1
                    target_w = int(target_h * aspect_ratio)
                    icon_resized = icon_img.resize((target_w, target_h), Image.Resampling.LANCZOS)

                    icon_x = x + int(15 * scale)
                    icon_y = y + (h - icon_resized.height) // 2

                    overlay_img.paste(icon_resized, (icon_x, icon_y), icon_resized)
                    text_start_x = icon_x + icon_resized.width + int(12 * scale)
            except Exception as e:
                logger.error(f"加载或缩放图标失败 {icon_name}: {e}")

    name = item.get("name", "")
    desc = item.get("desc", "")
    name_font = fonts_map["name"]
    desc_font = fonts_map["desc"]
    name_color = fonts_map["name_color"]
    desc_color = fonts_map["desc_color"]
    line_spacing = int(4 * scale)

    try:
        name_h = name_font.getbbox(name)[3] - name_font.getbbox(name)[1] if name else 0
        desc_bbox = draw.multiline_textbbox((0, 0), desc, font=desc_font, spacing=line_spacing) if desc else (0, 0, 0,
                                                                                                              0)
        desc_h = desc_bbox[3] - desc_bbox[1]
    except Exception:
        name_h = name_font.getsize(name)[1] if name else 0
        desc_h = 0
        if desc:
            lines = desc.split('\n')
            desc_h = sum(desc_font.getsize(line)[1] for line in lines) + (len(lines) - 1) * line_spacing

    gap = int(5 * scale)
    total_text_height = name_h + (desc_h + gap if desc else 0)
    text_start_y = y + (h - total_text_height) / 2

    if name:
        draw_text_with_shadow(draw, (text_start_x, text_start_y), name, name_font, name_color, shadow_cfg, scale=scale)
    if desc:
        draw_text_with_shadow(draw, (text_start_x, text_start_y + name_h + gap), desc, desc_font, desc_color,
                              shadow_cfg, spacing=line_spacing, scale=scale)


def get_style(obj: dict, menu: dict, key: str, fallback_key: str, default=None):
    val = obj.get(key)
    if val is not None and val != "":
        return val
    return menu.get(fallback_key, default)


def render_one_menu(menu_data: dict) -> Image.Image:
    scale = float(menu_data.get("export_scale", 1.0))
    if scale <= 0: scale = 1.0

    def s(val):
        return int(val * scale)

    PADDING_X = s(BASE_PADDING_X)
    GROUP_GAP = s(BASE_GROUP_GAP)
    ITEM_H = s(BASE_ITEM_H)
    ITEM_GAP_X = s(BASE_ITEM_GAP_X)
    ITEM_GAP_Y = s(BASE_ITEM_GAP_Y)
    TITLE_TOP_MARGIN = s(80)

    use_canvas_size = menu_data.get("use_canvas_size", False)
    canvas_w_set = int(menu_data.get("canvas_width", 1000))
    canvas_h_set = int(menu_data.get("canvas_height", 2000))
    canvas_color_hex = menu_data.get("canvas_color", "#1e1e1e")

    base_w = canvas_w_set if canvas_w_set > 0 else 1000
    final_w = s(base_w)

    columns = max(1, int(menu_data.get("layout_columns") or 3))

    shadow_cfg = {
        'enabled': menu_data.get('shadow_enabled', False),
        'color': menu_data.get('shadow_color', '#000000'),
        'offset_x': menu_data.get('shadow_offset_x', 2),
        'offset_y': menu_data.get('shadow_offset_y', 2),
        'radius': menu_data.get('shadow_radius', 2)
    }

    title_size = s(int(menu_data.get("title_size") or 60))
    header_height = TITLE_TOP_MARGIN + title_size + s(10) + int(title_size * 0.5) + s(30)
    current_y = header_height
    group_layout_info = []

    for group in menu_data.get("groups", []):
        is_free = group.get("free_mode", False)
        items = group.get("items", [])
        g_cols = group.get("layout_columns") or columns

        g_title_size = s(int(get_style(group, menu_data, 'title_size', 'group_title_size', 30)))
        box_start_y = current_y + g_title_size + s(20)

        content_h = 0
        if is_free:
            max_bottom = max((s(int(item.get("y", 0))) + s(int(item.get("h", 100))) for item in items), default=0)
            content_h = max(s(int(group.get("min_height", 100))), max_bottom + s(20))
        elif items:
            rows = (len(items) + g_cols - 1) // g_cols
            content_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + s(30)

        box_rect = (PADDING_X, box_start_y, final_w - PADDING_X, box_start_y + content_h)
        group_layout_info.append(
            {"data": group, "title_y": current_y, "box_rect": box_rect, "is_free": is_free, "columns": g_cols})

        current_y = box_start_y + content_h + GROUP_GAP

    final_h = current_y + s(50)
    if not use_canvas_size:
        if (bg_name := menu_data.get("background")) and plugin_storage.bg_dir:
            bg_path = plugin_storage.bg_dir / bg_name
            if bg_path.exists():
                try:
                    with Image.open(bg_path) as bg_img:
                        if bg_img.width > 0:
                            aspect_ratio = bg_img.height / bg_img.width
                            bg_fit_h = int(final_w * aspect_ratio)
                            final_h = max(final_h, bg_fit_h)
                except Exception:
                    pass
    else:
        final_h = s(canvas_h_set)

    base = Image.new("RGBA", (final_w, final_h), hex_to_rgb(canvas_color_hex))

    if bg_name := menu_data.get("background"):
        if plugin_storage.bg_dir:
            bg_path = plugin_storage.bg_dir / bg_name
            if bg_path.exists():
                try:
                    with Image.open(bg_path).convert("RGBA") as bg_img:
                        scale_bg = final_w / bg_img.width
                        bg_resized = bg_img.resize((final_w, int(bg_img.height * scale_bg)), Image.Resampling.LANCZOS)
                        base.paste(bg_resized, (0, 0), bg_resized)
                except Exception as e:
                    logger.error(f"背景图绘制错误: {e}")

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)

    title_font = load_font(menu_data.get("title_font", "title.ttf"), title_size)
    sub_title_font = load_font(menu_data.get("title_font", "title.ttf"), int(title_size * 0.5))
    align = menu_data.get("title_align", "center")
    title_x = {"left": PADDING_X, "right": final_w - PADDING_X, "center": final_w / 2}
    anchor = {"left": "lt", "right": "rt", "center": "mt"}

    draw_text_with_shadow(draw_ov, (title_x[align], TITLE_TOP_MARGIN), menu_data.get("title", ""),
                          title_font, hex_to_rgb(menu_data.get("title_color")), shadow_cfg, anchor=anchor[align],
                          scale=scale)
    draw_text_with_shadow(draw_ov, (title_x[align], TITLE_TOP_MARGIN + title_size + s(10)),
                          menu_data.get("sub_title", ""),
                          sub_title_font, hex_to_rgb(menu_data.get("subtitle_color")), shadow_cfg, anchor=anchor[align],
                          scale=scale)

    for g_info in group_layout_info:
        group = g_info["data"]
        box_x, box_y, box_x2, box_y2 = g_info["box_rect"]
        box_w = box_x2 - box_x

        g_bg_color = get_style(group, menu_data, 'bg_color', 'group_bg_color', '#000000')
        g_bg_alpha = get_style(group, menu_data, 'bg_alpha', 'group_bg_alpha', 50)
        g_blur = menu_data.get("group_blur_radius", 0)
        draw_glass_rect(base, g_info["box_rect"], g_bg_color, g_bg_alpha, g_blur, corner_r=s(15))

        g_title_size = s(int(get_style(group, menu_data, 'title_size', 'group_title_size', 30)))
        g_sub_size = s(int(get_style(group, menu_data, 'sub_size', 'group_sub_size', 18)))
        g_title_font = load_font(get_style(group, menu_data, 'title_font', 'group_title_font', 'text.ttf'),
                                 g_title_size)
        g_sub_font = load_font(get_style(group, menu_data, 'sub_font', 'group_sub_font', 'text.ttf'), g_sub_size)
        g_title_color = hex_to_rgb(get_style(group, menu_data, 'title_color', 'group_title_color', '#FFFFFF'))
        g_sub_color = hex_to_rgb(get_style(group, menu_data, 'sub_color', 'group_sub_color', '#AAAAAA'))

        title_text = group.get("title", "")
        subtitle_text = group.get("subtitle", "")

        try:
            title_bbox = g_title_font.getbbox(title_text) if title_text else (0, 0, 0, 0)
            title_h = title_bbox[3] - title_bbox[1]
            sub_bbox = g_sub_font.getbbox(subtitle_text) if subtitle_text else (0, 0, 0, 0)
            sub_h = sub_bbox[3] - sub_bbox[1]
        except Exception:
            title_h = g_title_font.getsize(title_text)[1] if title_text else 0
            sub_h = g_sub_font.getsize(subtitle_text)[1] if subtitle_text else 0

        title_y_pos = g_info["title_y"] + s(10)
        draw_text_with_shadow(draw_ov, (box_x + s(10), title_y_pos), title_text, g_title_font, g_title_color,
                              shadow_cfg, scale=scale)

        if subtitle_text:
            try:
                title_w = draw_ov.textlength(title_text, font=g_title_font)
            except:
                title_w = g_title_font.getsize(title_text)[0]

            y_offset = (title_h - sub_h) / 2
            draw_text_with_shadow(draw_ov, (box_x + s(10) + title_w + s(10), title_y_pos + y_offset),
                                  subtitle_text, g_sub_font, g_sub_color, shadow_cfg, scale=scale)

        item_grid_w = (box_w - s(40) - (g_info["columns"] - 1) * ITEM_GAP_X) // g_info["columns"]
        for i, item in enumerate(group.get("items", [])):
            if g_info["is_free"]:
                ix, iy = box_x + s(int(item.get("x", 0))), box_y + s(int(item.get("y", 0)))
                iw, ih = s(int(item.get("w", 100))), s(int(item.get("h", 100)))
            else:
                row, col = i // g_info["columns"], i % g_info["columns"]
                ix = box_x + s(20) + col * (item_grid_w + ITEM_GAP_X)
                iy = box_y + s(20) + row * (ITEM_H + ITEM_GAP_Y)
                iw, ih = item_grid_w, ITEM_H

            i_bg_color = get_style(item, menu_data, 'bg_color', 'item_bg_color', '#FFFFFF')
            i_bg_alpha = get_style(item, menu_data, 'bg_alpha', 'item_bg_alpha', 20)
            i_blur = menu_data.get("item_blur_radius", 0)
            draw_glass_rect(base, (ix, iy, ix + iw, iy + ih), i_bg_color, i_bg_alpha, i_blur, corner_r=s(10))

            item_fonts_map = {
                "name": load_font(get_style(item, menu_data, 'name_font', 'item_name_font', 'title.ttf'),
                                  s(get_style(item, menu_data, 'name_size', 'item_name_size', 26))),
                "desc": load_font(get_style(item, menu_data, 'desc_font', 'item_desc_font', 'text.ttf'),
                                  s(get_style(item, menu_data, 'desc_size', 'item_desc_size', 16))),
                "name_color": hex_to_rgb(get_style(item, menu_data, 'name_color', 'item_name_color', '#FFFFFF')),
                "desc_color": hex_to_rgb(get_style(item, menu_data, 'desc_color', 'item_desc_color', '#AAAAAA')),
            }
            render_item_content(overlay, draw_ov, item, (ix, iy, ix + iw, iy + ih), item_fonts_map, shadow_cfg, scale)

    widgets = menu_data.get("custom_widgets", [])
    for w in widgets:
        try:
            w_type = w.get("type")
            wx, wy = s(int(w.get("x", 0))), s(int(w.get("y", 0)))
            if w_type == 'image':
                content = w.get("content")
                if content and plugin_storage.img_dir:
                    img_path = plugin_storage.img_dir / content
                    if img_path.exists():
                        ww, wh = s(int(w.get("width", 100))), s(int(w.get("height", 100)))
                        with Image.open(img_path).convert("RGBA") as w_img:
                            w_resized = w_img.resize((ww, wh), Image.Resampling.LANCZOS)
                            overlay.paste(w_resized, (wx, wy), w_resized)
            elif w_type == 'text':
                text = w.get("text", "Text")
                size = s(int(w.get("size", 40)))
                color = hex_to_rgb(w.get("color", "#FFFFFF"))
                font_name = w.get("font", "")
                font = load_font(font_name, size)
                draw_text_with_shadow(draw_ov, (wx, wy), text, font, color, shadow_cfg, scale=scale)
        except Exception as e:
            logger.error(f"渲染组件失败: {e}")

    return Image.alpha_composite(base, overlay)