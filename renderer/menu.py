import traceback
import imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
from typing import Optional, Tuple

try:
    from astrbot.api import logger
except ImportError:
    import logging

    logger = logging.getLogger(__name__)

from ..storage import plugin_storage

# --- Constants ---
BASE_PADDING_X = 40
BASE_GROUP_GAP = 30
BASE_ITEM_H = 90
BASE_ITEM_GAP_X = 15
BASE_ITEM_GAP_Y = 15


def load_font(font_name: str, size: int) -> ImageFont.FreeTypeFont:
    if not font_name or not plugin_storage.fonts_dir: return ImageFont.load_default()
    font_path = plugin_storage.fonts_dir / font_name
    try:
        if font_path.exists(): return ImageFont.truetype(str(font_path), int(size))
        return ImageFont.load_default()
    except:
        return ImageFont.load_default()


def hex_to_rgb(hex_color):
    hex_color = (hex_color or "#000000").lstrip('#')
    try:
        if len(hex_color) == 6: return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
        if len(hex_color) == 3: return tuple(int(c * 2, 16) for c in hex_color)
    except:
        pass
    return 30, 30, 30


def _safe_multiline_text(draw, xy, text, font, fill, anchor=None, spacing=4):
    try:
        draw.multiline_text(xy, text, font=font, fill=fill, anchor=anchor, spacing=spacing)
    except ValueError as e:
        if "anchor" in str(e):
            x, y = xy
            try:
                if hasattr(draw, "multiline_textbbox"):
                    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing)
                    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
                else:
                    w, h = draw.multiline_textsize(text, font=font, spacing=spacing)
            except:
                w, h = 0, 0
            if anchor:
                ax, ay = anchor[0].lower(), anchor[1].lower()
                if ax == 'm':
                    x -= w / 2
                elif ax == 'r':
                    x -= w
                if ay == 'm':
                    y -= h / 2
                elif ay == 'b':
                    y -= h
            draw.multiline_text((x, y), text, font=font, fill=fill, spacing=spacing)
        else:
            raise e


def draw_text_with_shadow(draw, pos, text, font, fill, shadow_cfg, anchor=None, spacing=4, scale=1.0, text_styles=None):
    """绘制带阴影的文本，支持样式（粗体、斜体、下划线）"""
    x, y = pos
    if not text: return
    
    # 绘制下划线（如果启用）
    if text_styles and text_styles.get('underline'):
        try:
            if hasattr(draw, 'textbbox'):
                bbox = draw.textbbox((x, y), text, font=font, anchor=anchor)
                underline_y = bbox[3] + 2
                draw.line([(bbox[0], underline_y), (bbox[2], underline_y)], fill=fill, width=2)
            else:
                text_width, _ = draw.textsize(text, font=font)
                underline_y = y + font.size + 2
                draw.line([(x, underline_y), (x + text_width, underline_y)], fill=fill, width=2)
        except:
            pass
    
    # 绘制阴影
    if shadow_cfg.get('enabled'):
        s_color = hex_to_rgb(shadow_cfg.get('color', '#000000'))
        off_x, off_y = int(shadow_cfg.get('offset_x', 2) * scale), int(shadow_cfg.get('offset_y', 2) * scale)
        _safe_multiline_text(draw, (x + off_x, y + off_y), text, font, fill=s_color, anchor=anchor, spacing=spacing)
    
    # 绘制正文
    _safe_multiline_text(draw, (x, y), text, font, fill=fill, anchor=anchor, spacing=spacing)



def get_text_style_str(obj, style_prefix):
    """从对象中获取文本样式信息（粗体、斜体、下划线）"""
    bold = obj.get(style_prefix + '_bold', False)
    italic = obj.get(style_prefix + '_italic', False)
    underline = obj.get(style_prefix + '_underline', False)
    return {'bold': bold, 'italic': italic, 'underline': underline}


def draw_glass_rect(base_img: Image.Image, box: tuple, color_hex: str, alpha: int, radius: int, corner_r=15):
    overlay = Image.new("RGBA", base_img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle(box, radius=corner_r, fill=hex_to_rgb(color_hex) + (int(alpha),))
    base_img.alpha_composite(overlay)


def wrap_text_to_width(text: str, font, max_width: int, draw) -> str:
    """将文本根据最大宽度自动换行"""
    if not text or max_width <= 0:
        return text
    
    # 如果已经有手动换行，分别处理每一行
    lines = text.split('\n')
    wrapped_lines = []
    
    for line in lines:
        if not line:
            wrapped_lines.append('')
            continue
            
        # 计算当前行宽度
        try:
            if hasattr(draw, 'textbbox'):
                line_width = draw.textbbox((0, 0), line, font=font)[2]
            else:
                line_width = draw.textsize(line, font=font)[0]
        except:
            line_width = len(line) * 20
        
        # 如果不超过最大宽度，直接添加
        if line_width <= max_width:
            wrapped_lines.append(line)
            continue
        
        # 需要换行
        current_line = ''
        for char in line:
            test_line = current_line + char
            try:
                if hasattr(draw, 'textbbox'):
                    test_width = draw.textbbox((0, 0), test_line, font=font)[2]
                else:
                    test_width = draw.textsize(test_line, font=font)[0]
            except:
                test_width = len(test_line) * 20
            
            if test_width <= max_width:
                current_line = test_line
            else:
                if current_line:
                    wrapped_lines.append(current_line)
                current_line = char
        
        if current_line:
            wrapped_lines.append(current_line)
    
    return '\n'.join(wrapped_lines)


def render_item_content(overlay_img, draw, item, box, fonts_map, shadow_cfg, menu_data, scale):
    x, y, x2, y2 = box
    w, h = x2 - x, y2 - y
    icon_name = item.get("icon", "")
    text_start_x = x + int(15 * scale)
    text_max_width = w - int(30 * scale)  # 文本最大宽度

    if icon_name and plugin_storage.icon_dir:
        icon_path = plugin_storage.icon_dir / icon_name
        if icon_path.exists():
            try:
                with Image.open(icon_path).convert("RGBA") as icon_img:
                    custom_icon_size = item.get("icon_size")
                    target_h = int(int(custom_icon_size) * scale) if custom_icon_size and int(
                        custom_icon_size) > 0 else int(h * 0.6)
                    aspect_ratio = icon_img.width / icon_img.height if icon_img.height > 0 else 1
                    target_w = int(target_h * aspect_ratio)
                    icon_resized = icon_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                    icon_x, icon_y = x + int(15 * scale), y + (h - icon_resized.height) // 2
                    overlay_img.paste(icon_resized, (icon_x, icon_y), icon_resized)
                    text_start_x = icon_x + icon_resized.width + int(12 * scale)
                    text_max_width = x2 - text_start_x - int(15 * scale)  # 更新文本最大宽度
            except:
                pass

    name, desc = item.get("name", ""), item.get("desc", "")
    name_font, desc_font = fonts_map["name"], fonts_map["desc"]
    line_spacing = int(4 * scale)
    
    # 自动换行处理
    if desc and text_max_width > 0:
        desc = wrap_text_to_width(desc, desc_font, text_max_width, draw)

    try:
        if name and hasattr(name_font, "getbbox"):
            bbox = name_font.getbbox(name)
            name_h = bbox[3] - bbox[1]
        elif name:
            name_h = name_font.getsize(name)[1]
        else:
            name_h = 0
    except:
        name_h = 20
    try:
        desc_h = 0
        if desc:
            if hasattr(draw, "multiline_textbbox"):
                desc_h = draw.multiline_textbbox((0, 0), desc, font=desc_font, spacing=line_spacing)[3] - \
                         draw.multiline_textbbox((0, 0), desc, font=desc_font, spacing=line_spacing)[1]
            else:
                desc_h = draw.multiline_textsize(desc, font=desc_font, spacing=line_spacing)[1]
    except:
        desc_h = 0

    gap = int(5 * scale)
    total_text_height = name_h + (desc_h + gap if desc else 0)
    text_start_y = y + (h - total_text_height) / 2
    
    # 获取功能项名称和描述的阴影配置和样式
    name_shadow = get_shadow_config(item, menu_data, 'item_name')
    desc_shadow = get_shadow_config(item, menu_data, 'item_desc')
    name_styles = get_text_style_str(item, 'item_name')
    desc_styles = get_text_style_str(item, 'item_desc')

    if name: draw_text_with_shadow(draw, (text_start_x, text_start_y), name, name_font, fonts_map["name_color"],
                                   name_shadow, scale=scale, text_styles=name_styles)
    if desc: draw_text_with_shadow(draw, (text_start_x, text_start_y + name_h + gap), desc, desc_font,
                                   fonts_map["desc_color"], desc_shadow, spacing=line_spacing, scale=scale, text_styles=desc_styles)


def get_style(obj: dict, menu: dict, key: str, fallback_key: str, default=None):
    val = obj.get(key)
    return val if val is not None and val != "" else menu.get(fallback_key, default)


def get_shadow_config(obj: dict, menu: dict, shadow_prefix: str):
    """获取元素级或全局阴影配置"""
    # 检查是否有元素级阴影启用标志
    shadow_key = shadow_prefix + '_shadow_enabled'
    if shadow_key in obj and obj[shadow_key]:
        # 使用元素级阴影配置
        return {
            'enabled': True,
            'color': obj.get(shadow_prefix + '_shadow_color', menu.get('shadow_color', '#000000')),
            'offset_x': obj.get(shadow_prefix + '_shadow_offset_x', menu.get('shadow_offset_x', 2)),
            'offset_y': obj.get(shadow_prefix + '_shadow_offset_y', menu.get('shadow_offset_y', 2)),
            'radius': obj.get(shadow_prefix + '_shadow_radius', menu.get('shadow_radius', 2))
        }
    else:
        # 使用全局阴影配置
        return {
            'enabled': menu.get('shadow_enabled', False),
            'color': menu.get('shadow_color', '#000000'),
            'offset_x': menu.get('shadow_offset_x', 2),
            'offset_y': menu.get('shadow_offset_y', 2),
            'radius': menu.get('shadow_radius', 2)
        }


def _calculate_bg_layout(src_w: int, src_h: int, canvas_w: int, canvas_h: int,
                         fit_mode: str, scale: float, align_x: str, align_y: str,
                         custom_w: int = 0, custom_h: int = 0) -> Tuple[int, int, int, int]:
    base_w, base_h = src_w, src_h
    ax = str(align_x or "center").lower().strip()
    ay = str(align_y or "center").lower().strip()

    if fit_mode == "custom" and custom_w > 0 and custom_h > 0:
        base_w, base_h = custom_w, custom_h
    else:
        src_ratio = src_w / src_h if src_h > 0 else 1
        canvas_ratio = canvas_w / canvas_h if canvas_h > 0 else 1

        if fit_mode == "contain":
            if src_ratio > canvas_ratio:
                base_w = canvas_w
                base_h = int(canvas_w / src_ratio)
            else:
                base_h = canvas_h
                base_w = int(canvas_h * src_ratio)

        elif fit_mode == "cover_w":
            base_w = canvas_w
            base_h = int(canvas_w / src_ratio)

        elif fit_mode == "cover_h":
            base_h = canvas_h
            base_w = int(canvas_h * src_ratio)

        else:
            if src_ratio > canvas_ratio:
                base_h = canvas_h
                base_w = int(canvas_h * src_ratio)
            else:
                base_w = canvas_w
                base_h = int(canvas_w / src_ratio)

    final_w = int(base_w * scale)
    final_h = int(base_h * scale)

    if ax == "left":
        px = 0
    elif ax == "right":
        px = canvas_w - final_w
    else:
        px = (canvas_w - final_w) // 2

    if ay == "top":
        py = 0
    elif ay == "bottom":
        py = canvas_h - final_h
    else:
        py = (canvas_h - final_h) // 2

    return final_w, final_h, px, py


def _render_layout(menu_data: dict, is_video_mode: bool) -> Image.Image:
    scale = float(menu_data.get("export_scale", 1.0))
    if scale <= 0: scale = 1.0

    def s(val):
        return int(val * scale)

    PADDING_X = s(BASE_PADDING_X)
    GROUP_GAP = s(BASE_GROUP_GAP)
    ITEM_H, ITEM_GAP_X, ITEM_GAP_Y = s(BASE_ITEM_H), s(BASE_ITEM_GAP_X), s(BASE_ITEM_GAP_Y)
    TITLE_TOP_MARGIN = s(80)

    use_canvas_size = menu_data.get("use_canvas_size", False)
    canvas_w_set = int(menu_data.get("canvas_width", 1000))
    canvas_h_set = int(menu_data.get("canvas_height", 2000))

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
    current_y, group_layout_info = header_height, []

    for group in menu_data.get("groups", []):
        is_free = group.get("free_mode", False)
        is_text_group = group.get("group_type") == "text"
        items, g_cols = group.get("items", []), group.get("layout_columns") or columns
        g_title_size = s(int(get_style(group, menu_data, 'title_size', 'group_title_size', 30)))
        box_start_y = current_y + g_title_size + s(20)
        
        if is_text_group:
            # 纯文本分组 - 自适应高度
            text_content = group.get("text_content", "")
            gsf = load_font(get_style(group, menu_data, 'sub_font', 'group_sub_font', 'text.ttf'),
                           s(int(get_style(group, menu_data, 'sub_size', 'group_sub_size', 18))))
            temp_draw = ImageDraw.Draw(Image.new("RGBA", (final_w - PADDING_X * 2, 1)))
            
            if hasattr(temp_draw, "multiline_textbbox"):
                bbox = temp_draw.multiline_textbbox((0, 0), text_content, font=gsf, spacing=4)
                content_h = bbox[3] - bbox[1] + s(40)
            else:
                _, text_h = temp_draw.multiline_textsize(text_content, font=gsf, spacing=4)
                content_h = text_h + s(40)
        elif is_free:
            max_bottom = max((s(int(item.get("y", 0))) + s(int(item.get("h", 100))) for item in items), default=0)
            content_h = max(s(int(group.get("min_height", 100))), max_bottom + s(20))
        elif items:
            rows = (len(items) + g_cols - 1) // g_cols
            content_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + s(30)
        else:
            content_h = s(50)
        group_layout_info.append({"data": group, "title_y": current_y,
                                  "box_rect": (PADDING_X, box_start_y, final_w - PADDING_X, box_start_y + content_h),
                                  "is_free": is_free, "is_text_group": is_text_group, "columns": g_cols})
        current_y = box_start_y + content_h + GROUP_GAP

    content_final_h = current_y + s(50)

    if use_canvas_size:
        final_h = s(canvas_h_set)
    else:
        final_h = content_final_h
        bg_aspect_h = 0
        if not is_video_mode and (bg_name := menu_data.get("background")) and plugin_storage.bg_dir:
            try:
                with Image.open(plugin_storage.bg_dir / bg_name) as bg_img:
                    if bg_img.width > 0:
                        bg_aspect_h = int(final_w * (bg_img.height / bg_img.width))
            except:
                pass
        if bg_aspect_h > final_h: final_h = bg_aspect_h

    overlay = Image.new("RGBA", (final_w, final_h), (0, 0, 0, 0))
    draw_ov = ImageDraw.Draw(overlay)

    tf = load_font(menu_data.get("title_font", "title.ttf"), title_size)
    sf = load_font(menu_data.get("subtitle_font") or menu_data.get("title_font", "title.ttf"), int(title_size * 0.5))
    al = menu_data.get("title_align", "center")
    tx = {"left": PADDING_X, "right": final_w - PADDING_X, "center": final_w / 2}[al]
    anc = {"left": "lt", "right": "rt", "center": "mt"}[al]
    
    # 获取主标题的阴影配置和样式
    title_shadow = get_shadow_config(menu_data, menu_data, 'title')
    title_styles = get_text_style_str(menu_data, 'title')
    draw_text_with_shadow(draw_ov, (tx, TITLE_TOP_MARGIN), menu_data.get("title", ""), tf,
                          hex_to_rgb(menu_data.get("title_color") or "#FFFFFF"), title_shadow, anchor=anc, scale=scale, text_styles=title_styles)
    
    # 获取副标题的阴影配置和样式
    subtitle_shadow = get_shadow_config(menu_data, menu_data, 'subtitle')
    subtitle_styles = get_text_style_str(menu_data, 'subtitle')
    draw_text_with_shadow(draw_ov, (tx, TITLE_TOP_MARGIN + title_size + s(10)), menu_data.get("sub_title", ""), sf,
                          hex_to_rgb(menu_data.get("subtitle_color") or "#FFFFFF"), subtitle_shadow, anchor=anc, scale=scale, text_styles=subtitle_styles)

    for g_info in group_layout_info:
        grp = g_info["data"]
        bx, by, bx2, by2 = g_info["box_rect"]
        bw = bx2 - bx
        is_text_group = g_info.get("is_text_group", False)
        
        # 使用分组自定义模糊半径或全局模糊半径
        group_blur = get_style(grp, menu_data, 'blur_radius', 'group_blur_radius', 0)
        
        # 处理分组自定义大小
        group_custom_w = grp.get("custom_width") or menu_data.get("group_custom_width")
        group_custom_h = grp.get("custom_height") or menu_data.get("group_custom_height")
        
        # 如果设置了自定义大小，使用自定义大小；否则使用计算的矩形
        if group_custom_w and group_custom_h:
            bx2 = bx + s(int(group_custom_w))
            by2 = by + s(int(group_custom_h))
            bw = bx2 - bx
        
        draw_glass_rect(overlay, (bx, by, bx2, by2), get_style(grp, menu_data, 'bg_color', 'group_bg_color', '#000000'),
                        get_style(grp, menu_data, 'bg_alpha', 'group_bg_alpha', 50),
                        group_blur, corner_r=s(15))

        gtf = load_font(get_style(grp, menu_data, 'title_font', 'group_title_font', 'text.ttf'),
                        s(int(get_style(grp, menu_data, 'title_size', 'group_title_size', 30))))
        gsf = load_font(get_style(grp, menu_data, 'sub_font', 'group_sub_font', 'text.ttf'),
                        s(int(get_style(grp, menu_data, 'sub_size', 'group_sub_size', 18))))

        title_text = grp.get("title", "")
        sub_text = grp.get("subtitle", "")
        ty = g_info["title_y"] + s(10)
        title_x = bx + s(10)
        
        # 获取分组标题的阴影配置和样式
        group_title_shadow = get_shadow_config(grp, menu_data, 'group_title')
        group_title_styles = get_text_style_str(grp, 'group_title')

        draw_text_with_shadow(draw_ov, (title_x, ty), title_text, gtf,
                              hex_to_rgb(get_style(grp, menu_data, 'title_color', 'group_title_color', '#FFFFFF')),
                              group_title_shadow, scale=scale, text_styles=group_title_styles)

        if is_text_group:
            # 纯文本分组处理
            text_content = grp.get("text_content", "")
            text_y = by + s(20)
            text_x = bx + s(20)
            max_text_width = bx2 - text_x - s(20)
            
            # 获取纯文本的字体、颜色、大小 - 优先从分组属性读取，再从全局设置读取
            text_font_name = grp.get("text_font") or menu_data.get("group_sub_font", "text.ttf")
            text_font_size_val = grp.get("text_size")
            if text_font_size_val:
                text_font_size = int(text_font_size_val)
            else:
                text_font_size = int(menu_data.get("group_sub_size", 30))
            
            # 获取文本样式（粗体、斜体、下划线）
            text_bold = grp.get("text_bold", False)
            text_italic = grp.get("text_italic", False)
            text_underline = grp.get("text_underline", False)
            
            text_font = load_font(text_font_name, s(text_font_size))
            text_color_hex = grp.get("text_color") or menu_data.get("group_sub_color", '#AAAAAA')
            text_color = hex_to_rgb(text_color_hex)
            
            # 绘制纯文本内容，支持自动换行
            if text_content and max_text_width > 0:
                text_content = wrap_text_to_width(text_content, text_font, max_text_width, draw_ov)
            
            # 获取纯文本的阴影配置
            text_shadow = get_shadow_config(grp, menu_data, 'group_sub')
            
            # 获取纯文本的背景毛玻璃效果配置
            text_bg_color = grp.get("text_bg_color") or menu_data.get("group_sub_bg_color", "#333333")
            text_bg_alpha = int(grp.get("text_bg_alpha", menu_data.get("group_sub_bg_alpha", 200)))
            text_bg_blur = int(grp.get("text_bg_blur", menu_data.get("group_sub_bg_blur", 5)))
            
            # 如果启用背景毛玻璃效果，先绘制背景
            if text_bg_alpha > 0 and text_bg_blur >= 0:
                # 计算背景区域（文本周围留一些边距）
                bg_padding = s(10)
                bg_x1 = max(bx, text_x - bg_padding)
                bg_y1 = max(by, text_y - bg_padding)
                bg_x2 = min(bx2, text_x + max_text_width + bg_padding)
                bg_y2 = min(by2, text_y + s(100) + bg_padding)  # 假设最大高度
                
                # 绘制背景矩形 (毛玻璃效果)
                bg_rgb = hex_to_rgb(text_bg_color)
                if text_bg_blur > 0:
                    # 模糊背景 (使用简单的半透明填充模拟毛玻璃)
                    blur_image = Image.new('RGBA', (img.width, img.height), (0, 0, 0, 0))
                    blur_draw = ImageDraw.Draw(blur_image)
                    blur_draw.rectangle([(bg_x1, bg_y1), (bg_x2, bg_y2)], 
                                       fill=(bg_rgb[0], bg_rgb[1], bg_rgb[2], text_bg_alpha))
                    
                    # 对模糊图像应用高斯模糊
                    blur_image = blur_image.filter(ImageFilter.GaussianBlur(radius=text_bg_blur))
                    img.paste(blur_image, (0, 0), blur_image)
                else:
                    # 不模糊，直接填充
                    draw_ov.rectangle([(bg_x1, bg_y1), (bg_x2, bg_y2)], 
                                     fill=(bg_rgb[0], bg_rgb[1], bg_rgb[2], text_bg_alpha))
            
            draw_text_with_shadow(draw_ov, (text_x, text_y), text_content or "", text_font,
                                 text_color, text_shadow, scale=scale, text_styles=get_text_style_str(grp, 'text'))
        else:
            # 功能项分组处理
            if sub_text:
                try:
                    if hasattr(draw_ov, "textbbox"):
                        bbox = draw_ov.textbbox((0, 0), title_text, font=gtf)
                        title_w = bbox[2] - bbox[0]
                        title_h = bbox[3] - bbox[1]
                    else:
                        title_w, title_h = draw_ov.textsize(title_text, font=gtf)
                except:
                    title_w, title_h = 100, 30

                try:
                    if hasattr(draw_ov, "textbbox"):
                        s_bbox = draw_ov.textbbox((0, 0), sub_text, font=gsf)
                        sub_h = s_bbox[3] - s_bbox[1]
                    else:
                        _, sub_h = draw_ov.textsize(sub_text, font=gsf)
                except:
                    sub_h = 18

                align = get_style(grp, menu_data, 'sub_align', 'group_sub_align', 'bottom')

                sub_x = title_x + title_w + s(15)
                sub_y = ty

                if align == 'bottom':
                    sub_y = ty + title_h - sub_h - s(2)
                elif align == 'center':
                    sub_y = ty + (title_h - sub_h) / 2
                
                # 获取分组副标题的阴影配置和样式
                group_sub_shadow = get_shadow_config(grp, menu_data, 'group_sub')
                group_sub_styles = get_text_style_str(grp, 'group_sub')
                draw_text_with_shadow(draw_ov, (sub_x, sub_y), sub_text, gsf,
                                      hex_to_rgb(get_style(grp, menu_data, 'sub_color', 'group_sub_color', '#AAAAAA')),
                                      group_sub_shadow, scale=scale, text_styles=group_sub_styles)

            item_grid_w = (bw - s(40) - (g_info["columns"] - 1) * ITEM_GAP_X) // g_info["columns"]
            for i, item in enumerate(grp.get("items", [])):
                if g_info["is_free"]:
                    ix, iy, iw, ih = bx + s(int(item.get("x", 0))), by + s(int(item.get("y", 0))), s(
                        int(item.get("w", 100))), s(int(item.get("h", 100)))
                else:
                    r, c = i // g_info["columns"], i % g_info["columns"]
                    ix, iy, iw, ih = bx + s(20) + c * (item_grid_w + ITEM_GAP_X), by + s(20) + r * (
                            ITEM_H + ITEM_GAP_Y), item_grid_w, ITEM_H
                
                # 处理功能项自定义大小
                item_custom_w = item.get("custom_width") or menu_data.get("item_custom_width")
                item_custom_h = item.get("custom_height") or menu_data.get("item_custom_height")
                if item_custom_w and item_custom_h:
                    iw = s(int(item_custom_w))
                    ih = s(int(item_custom_h))
                
                # 使用功能项自定义模糊半径或全局模糊半径
                item_blur = get_style(item, menu_data, 'blur_radius', 'item_blur_radius', 0)
                
                draw_glass_rect(overlay, (ix, iy, ix + iw, iy + ih),
                                get_style(item, menu_data, 'bg_color', 'item_bg_color', '#FFFFFF'),
                                get_style(item, menu_data, 'bg_alpha', 'item_bg_alpha', 20),
                                item_blur, corner_r=s(10))
                
                # 为每个功能项构建字体和颜色配置
                fmap = {
                    "name": load_font(get_style(item, menu_data, 'name_font', 'item_name_font', 'title.ttf'),
                                      s(get_style(item, menu_data, 'name_size', 'item_name_size', 26))),
                    "desc": load_font(get_style(item, menu_data, 'desc_font', 'item_desc_font', 'text.ttf'),
                                      s(get_style(item, menu_data, 'desc_size', 'item_desc_size', 16))),
                    "name_color": hex_to_rgb(get_style(item, menu_data, 'name_color', 'item_name_color', '#FFFFFF')),
                    "desc_color": hex_to_rgb(get_style(item, menu_data, 'desc_color', 'item_desc_color', '#AAAAAA')),
                }
                render_item_content(overlay, draw_ov, item, (ix, iy, ix + iw, iy + ih), fmap, shadow_cfg, menu_data, scale)
    for w in menu_data.get("custom_widgets", []):
        try:
            wx, wy = s(int(w.get("x", 0))), s(int(w.get("y", 0)))
            if w.get("type") == 'image':
                if (c := w.get("content")) and plugin_storage.img_dir:
                    with Image.open(plugin_storage.img_dir / c).convert("RGBA") as wi:
                        wi = wi.resize((s(int(w.get("width", 100))), s(int(w.get("height", 100)))),
                                       Image.Resampling.LANCZOS)
                        overlay.paste(wi, (wx, wy), wi)
            else:
                f = load_font(w.get("font", ""), s(int(w.get("size", 40))))
                draw_text_with_shadow(draw_ov, (wx, wy), w.get("text", "Text"), f, hex_to_rgb(w.get("color", "#FFF")),
                                      shadow_cfg, scale=scale)
        except:
            pass
    return overlay


def render_static(menu_data: dict) -> Image.Image:
    import random
    layout_img = _render_layout(menu_data, is_video_mode=False)
    fw, fh = layout_img.size

    scale = float(menu_data.get("export_scale", 1.0))
    if scale <= 0: scale = 1.0

    def s(val):
        return int(val * scale)

    c_color = hex_to_rgb(menu_data.get("canvas_color", "#1e1e1e"))
    final_img = Image.new("RGBA", (fw, fh), c_color + (255,))

    # 随机背景支持：优先使用 backgrounds 列表，否则使用单个 background
    bg_name = None
    backgrounds_list = menu_data.get("backgrounds", [])
    if backgrounds_list:
        bg_name = random.choice(backgrounds_list)
    else:
        bg_name = menu_data.get("background")

    if bg_name and plugin_storage.bg_dir:
        try:
            with Image.open(plugin_storage.bg_dir / bg_name).convert("RGBA") as bg_img:
                fit_mode = menu_data.get("bg_fit_mode", "cover")
                align_x = menu_data.get("bg_align_x", "center")
                align_y = menu_data.get("bg_align_y", "center")
                bg_scale = float(menu_data.get("video_scale", 1.0))
                custom_w = s(int(menu_data.get("bg_custom_width", 1000)))
                custom_h = s(int(menu_data.get("bg_custom_height", 1000)))

                new_w, new_h, px, py = _calculate_bg_layout(
                    bg_img.width, bg_img.height, fw, fh,
                    fit_mode, bg_scale, align_x, align_y,
                    custom_w, custom_h
                )
                bg_rz = bg_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                final_img.paste(bg_rz, (px, py), bg_rz)
        except Exception as e:
            logger.error(f"Static BG Error: {e}")

    final_img.alpha_composite(layout_img)
    return final_img


def render_animated(menu_data: dict, output_path: Path) -> Optional[Path]:
    writer = None
    reader = None
    write_path = output_path

    try:
        foreground = _render_layout(menu_data, is_video_mode=True)
        cw, ch = foreground.size

        video_name = menu_data.get("bg_video")
        if not video_name or not plugin_storage.video_dir: return None
        video_path = plugin_storage.video_dir / video_name
        if not video_path.exists(): return None

        start_t = float(menu_data.get("video_start", 0))
        end_t = float(menu_data.get("video_end", 0))
        target_fps = int(menu_data.get("video_fps", 15))
        frame_ratio = max(1, int(menu_data.get("video_frame_ratio", 1)))

        bg_scale_factor = float(menu_data.get("video_scale", 1.0))
        fps_mode = menu_data.get("video_fps_mode", "fixed")

        reader = imageio.get_reader(str(video_path))
        meta = reader.get_meta_data()
        src_fps = meta.get('fps', 30)
        duration = meta.get('duration', 0)

        end_limit = duration
        if end_t > start_t: end_limit = min(duration, end_t)
        start_t = min(start_t, duration)

        step = max(1, int(round(src_fps / target_fps))) if fps_mode == "fixed" else frame_ratio

        fmt = menu_data.get("video_export_format", "apng").lower()
        writer_kwargs = {}
        format_str = None

        if fmt == "apng":
            format_str = 'FFMPEG'
            write_path = output_path.parent / f"temp_{output_path.stem}.mp4"
            writer_kwargs = {
                'fps': target_fps, 'codec': 'apng', 'pixelformat': 'rgba',
                'output_params': ['-f', 'apng', '-pred', 'mixed', '-plays', '0']
            }
            if write_path.exists():
                try:
                    write_path.unlink()
                except:
                    pass
        elif fmt == "webp":
            format_str = 'WEBP'
            writer_kwargs = {'fps': target_fps, 'quality': 60, 'loop': 0, 'method': 6, 'lossless': False}
        elif fmt == "gif":
            format_str = 'GIF'
            writer_kwargs = {'fps': target_fps, 'loop': 0, 'quantizer': 'nq', 'palettesize': 128}
        else:
            writer_kwargs = {'fps': target_fps}

        fit_mode = menu_data.get("bg_fit_mode", "cover")
        align_x = menu_data.get("video_align_x") or menu_data.get("bg_align_x", "center")
        align_y = menu_data.get("video_align") or menu_data.get("video_align_y") or menu_data.get("bg_align_y",
                                                                                                  "center")

        scale_global = float(menu_data.get("export_scale", 1.0))

        def s_loc(val):
            return int(val * scale_global)

        custom_w = s_loc(int(menu_data.get("bg_custom_width", 1000)))
        custom_h = s_loc(int(menu_data.get("bg_custom_height", 1000)))

        canvas_bg_color = hex_to_rgb(menu_data.get("canvas_color", "#1e1e1e"))
        base_bg = np.zeros((ch, cw, 4), dtype=np.uint8)
        base_bg[:, :, 0] = canvas_bg_color[0]
        base_bg[:, :, 1] = canvas_bg_color[1]
        base_bg[:, :, 2] = canvas_bg_color[2]
        base_bg[:, :, 3] = 255

        writer = imageio.get_writer(str(write_path), format=format_str, **writer_kwargs)
        frame_count, max_frames = 0, 300

        for i, frame in enumerate(reader):
            curr_time = i / src_fps
            if curr_time < start_t: continue
            if curr_time > end_limit: break
            if i % step != 0: continue

            fh_orig, fw_orig = frame.shape[:2]

            new_w, new_h, px, py = _calculate_bg_layout(
                fw_orig, fh_orig, cw, ch,
                fit_mode, bg_scale_factor, align_x, align_y,
                custom_w, custom_h
            )

            img_pil = Image.fromarray(frame).resize((new_w, new_h), Image.Resampling.NEAREST)
            frame_resized = np.array(img_pil)

            current_canvas_bg = base_bg.copy()

            y1, y2 = max(0, py), min(ch, py + new_h)
            x1, x2 = max(0, px), min(cw, px + new_w)

            sy1, sy2 = max(0, -py), min(new_h, new_h - (py + new_h - ch))
            sx1, sx2 = max(0, -px), min(new_w, new_w - (px + new_w - cw))

            if y2 > y1 and x2 > x1:
                if frame_resized.shape[2] == 3:
                    current_canvas_bg[y1:y2, x1:x2, :3] = frame_resized[sy1:sy2, sx1:sx2, :]
                else:
                    current_canvas_bg[y1:y2, x1:x2, :] = frame_resized[sy1:sy2, sx1:sx2, :]

            bg_with_video_pil = Image.fromarray(current_canvas_bg, mode="RGBA")
            bg_with_video_pil.alpha_composite(foreground)

            writer.append_data(np.array(bg_with_video_pil))
            frame_count += 1
            if frame_count >= max_frames: break

        writer.close()
        writer = None

        if write_path != output_path:
            if output_path.exists():
                output_path.unlink()
            write_path.rename(output_path)

        return output_path

    except Exception as e:
        logger.error(f"Render Stream Error: {traceback.format_exc()}")
        return None
    finally:
        if writer is not None:
            try:
                writer.close()
            except:
                pass
        if reader is not None:
            try:
                reader.close()
            except:
                pass