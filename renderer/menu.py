import traceback
import imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFont
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
    except:
        return 30, 30, 30
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


def draw_text_with_shadow(draw, pos, text, font, fill, shadow_cfg, anchor=None, spacing=4, scale=1.0):
    x, y = pos
    if not text: return
    if shadow_cfg.get('enabled'):
        s_color = hex_to_rgb(shadow_cfg.get('color', '#000000'))
        off_x, off_y = int(shadow_cfg.get('offset_x', 2) * scale), int(shadow_cfg.get('offset_y', 2) * scale)
        _safe_multiline_text(draw, (x + off_x, y + off_y), text, font, fill=s_color, anchor=anchor, spacing=spacing)
    _safe_multiline_text(draw, (x, y), text, font, fill=fill, anchor=anchor, spacing=spacing)


def draw_glass_rect(base_img: Image.Image, box: tuple, color_hex: str, alpha: int, radius: int, corner_r=15):
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
                    target_h = int(int(custom_icon_size) * scale) if custom_icon_size and int(
                        custom_icon_size) > 0 else int(h * 0.6)
                    aspect_ratio = icon_img.width / icon_img.height if icon_img.height > 0 else 1
                    target_w = int(target_h * aspect_ratio)
                    icon_resized = icon_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                    icon_x, icon_y = x + int(15 * scale), y + (h - icon_resized.height) // 2
                    overlay_img.paste(icon_resized, (icon_x, icon_y), icon_resized)
                    text_start_x = icon_x + icon_resized.width + int(12 * scale)
            except:
                pass

    name, desc = item.get("name", ""), item.get("desc", "")
    name_font, desc_font = fonts_map["name"], fonts_map["desc"]
    line_spacing = int(4 * scale)

    try:
        name_h = name_font.getbbox(name)[3] - name_font.getbbox(name)[1] if name and hasattr(name_font,
                                                                                             "getbbox") else (
            name_font.getsize(name)[1] if name else 0)
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

    if name: draw_text_with_shadow(draw, (text_start_x, text_start_y), name, name_font, fonts_map["name_color"],
                                   shadow_cfg, scale=scale)
    if desc: draw_text_with_shadow(draw, (text_start_x, text_start_y + name_h + gap), desc, desc_font,
                                   fonts_map["desc_color"], shadow_cfg, spacing=line_spacing, scale=scale)


def get_style(obj: dict, menu: dict, key: str, fallback_key: str, default=None):
    val = obj.get(key)
    return val if val is not None and val != "" else menu.get(fallback_key, default)


# ==================================================================================
# SHARED: Universal Background Layout Calculator
# ==================================================================================
def _calculate_bg_layout(src_w: int, src_h: int, canvas_w: int, canvas_h: int,
                         fit_mode: str, scale: float, align_x: str, align_y: str,
                         custom_w: int = 0, custom_h: int = 0) -> Tuple[int, int, int, int]:
    """
    统一计算背景图的尺寸和位置
    """
    # 1. 计算基础尺寸 (Base Size)
    base_w, base_h = src_w, src_h

    # 强转字符串并清理，防止 None 或 case 问题
    ax = str(align_x or "center").lower().strip()
    ay = str(align_y or "center").lower().strip()

    if fit_mode == "custom" and custom_w > 0 and custom_h > 0:
        base_w, base_h = custom_w, custom_h
    else:
        src_ratio = src_w / src_h if src_h > 0 else 1
        canvas_ratio = canvas_w / canvas_h if canvas_h > 0 else 1

        if fit_mode == "contain":
            if src_ratio > canvas_ratio:  # 图片更宽，定宽补高
                base_w = canvas_w
                base_h = int(canvas_w / src_ratio)
            else:  # 图片更高，定高补宽
                base_h = canvas_h
                base_w = int(canvas_h * src_ratio)

        elif fit_mode == "cover_w":  # 宽度撑满，高度随比例
            base_w = canvas_w
            base_h = int(canvas_w / src_ratio)

        elif fit_mode == "cover_h":  # 高度撑满，宽度随比例
            base_h = canvas_h
            base_w = int(canvas_h * src_ratio)

        else:  # "cover" (Default) - 智能填满
            if src_ratio > canvas_ratio:
                # 图片比画布更宽 -> 按高度填满，截取两边
                base_h = canvas_h
                base_w = int(canvas_h * src_ratio)
            else:
                # 图片比画布更高 -> 按宽度填满，截取上下
                base_w = canvas_w
                base_h = int(canvas_w / src_ratio)

    # 2. 应用缩放 (Scale)
    final_w = int(base_w * scale)
    final_h = int(base_h * scale)

    # 3. 计算对齐 (Alignment)
    if ax == "left":
        px = 0
    elif ax == "right":
        px = canvas_w - final_w
    else:  # center
        px = (canvas_w - final_w) // 2

    if ay == "top":
        py = 0
    elif ay == "bottom":
        py = canvas_h - final_h
    else:  # center
        py = (canvas_h - final_h) // 2

    return final_w, final_h, px, py


# ==================================================================================
# LAYER 1: Layout Calculation
# ==================================================================================
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
        items, g_cols = group.get("items", []), group.get("layout_columns") or columns
        g_title_size = s(int(get_style(group, menu_data, 'title_size', 'group_title_size', 30)))
        box_start_y = current_y + g_title_size + s(20)
        if is_free:
            max_bottom = max((s(int(item.get("y", 0))) + s(int(item.get("h", 100))) for item in items), default=0)
            content_h = max(s(int(group.get("min_height", 100))), max_bottom + s(20))
        elif items:
            rows = (len(items) + g_cols - 1) // g_cols
            content_h = rows * ITEM_H + (rows - 1) * ITEM_GAP_Y + s(30)
        else:
            content_h = s(50)
        group_layout_info.append({"data": group, "title_y": current_y,
                                  "box_rect": (PADDING_X, box_start_y, final_w - PADDING_X, box_start_y + content_h),
                                  "is_free": is_free, "columns": g_cols})
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
    sf = load_font(menu_data.get("title_font", "title.ttf"), int(title_size * 0.5))
    al = menu_data.get("title_align", "center")
    tx = {"left": PADDING_X, "right": final_w - PADDING_X, "center": final_w / 2}[al]
    anc = {"left": "lt", "right": "rt", "center": "mt"}[al]
    draw_text_with_shadow(draw_ov, (tx, TITLE_TOP_MARGIN), menu_data.get("title", ""), tf,
                          hex_to_rgb(menu_data.get("title_color")), shadow_cfg, anchor=anc, scale=scale)
    draw_text_with_shadow(draw_ov, (tx, TITLE_TOP_MARGIN + title_size + s(10)), menu_data.get("sub_title", ""), sf,
                          hex_to_rgb(menu_data.get("subtitle_color")), shadow_cfg, anchor=anc, scale=scale)

    for g_info in group_layout_info:
        grp = g_info["data"]
        bx, by, bx2, by2 = g_info["box_rect"]
        bw = bx2 - bx
        draw_glass_rect(overlay, g_info["box_rect"], get_style(grp, menu_data, 'bg_color', 'group_bg_color', '#000000'),
                        get_style(grp, menu_data, 'bg_alpha', 'group_bg_alpha', 50),
                        menu_data.get("group_blur_radius", 0), corner_r=s(15))
        gtf = load_font(get_style(grp, menu_data, 'title_font', 'group_title_font', 'text.ttf'),
                        s(int(get_style(grp, menu_data, 'title_size', 'group_title_size', 30))))
        gsf = load_font(get_style(grp, menu_data, 'sub_font', 'group_sub_font', 'text.ttf'),
                        s(int(get_style(grp, menu_data, 'sub_size', 'group_sub_size', 18))))
        ty = g_info["title_y"] + s(10)
        draw_text_with_shadow(draw_ov, (bx + s(10), ty), grp.get("title", ""), gtf,
                              hex_to_rgb(get_style(grp, menu_data, 'title_color', 'group_title_color', '#FFFFFF')),
                              shadow_cfg, scale=scale)
        if grp.get("subtitle"):
            try:
                tw = draw_ov.textlength(grp.get("title", ""), font=gtf)
            except:
                tw = 100
            draw_text_with_shadow(draw_ov, (bx + s(20) + tw, ty + (s(30) - s(18)) / 2), grp.get("subtitle", ""), gsf,
                                  hex_to_rgb(get_style(grp, menu_data, 'sub_color', 'group_sub_color', '#AAAAAA')),
                                  shadow_cfg, scale=scale)
        item_grid_w = (bw - s(40) - (g_info["columns"] - 1) * ITEM_GAP_X) // g_info["columns"]
        for i, item in enumerate(grp.get("items", [])):
            if g_info["is_free"]:
                ix, iy, iw, ih = bx + s(int(item.get("x", 0))), by + s(int(item.get("y", 0))), s(
                    int(item.get("w", 100))), s(int(item.get("h", 100)))
            else:
                r, c = i // g_info["columns"], i % g_info["columns"]
                ix, iy, iw, ih = bx + s(20) + c * (item_grid_w + ITEM_GAP_X), by + s(20) + r * (
                        ITEM_H + ITEM_GAP_Y), item_grid_w, ITEM_H
            draw_glass_rect(overlay, (ix, iy, ix + iw, iy + ih),
                            get_style(item, menu_data, 'bg_color', 'item_bg_color', '#FFFFFF'),
                            get_style(item, menu_data, 'bg_alpha', 'item_bg_alpha', 20),
                            menu_data.get("item_blur_radius", 0), corner_r=s(10))
            fmap = {
                "name": load_font(get_style(item, menu_data, 'name_font', 'item_name_font', 'title.ttf'),
                                  s(get_style(item, menu_data, 'name_size', 'item_name_size', 26))),
                "desc": load_font(get_style(item, menu_data, 'desc_font', 'item_desc_font', 'text.ttf'),
                                  s(get_style(item, menu_data, 'desc_size', 'item_desc_size', 16))),
                "name_color": hex_to_rgb(get_style(item, menu_data, 'name_color', 'item_name_color', '#FFFFFF')),
                "desc_color": hex_to_rgb(get_style(item, menu_data, 'desc_color', 'item_desc_color', '#AAAAAA')),
            }
            render_item_content(overlay, draw_ov, item, (ix, iy, ix + iw, iy + ih), fmap, shadow_cfg, scale)
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


# ==================================================================================
# LAYER 2: Static Renderer (Returns RGBA Image for PNG)
# ==================================================================================
def render_static(menu_data: dict) -> Image.Image:
    layout_img = _render_layout(menu_data, is_video_mode=False)
    fw, fh = layout_img.size

    scale = float(menu_data.get("export_scale", 1.0))
    if scale <= 0: scale = 1.0

    def s(val):
        return int(val * scale)

    c_color = hex_to_rgb(menu_data.get("canvas_color", "#1e1e1e"))
    final_img = Image.new("RGBA", (fw, fh), c_color + (255,))

    if (bg_name := menu_data.get("background")) and plugin_storage.bg_dir:
        try:
            with Image.open(plugin_storage.bg_dir / bg_name).convert("RGBA") as bg_img:

                # Fetch params - Default fit_mode changed to "cover" to match frontend
                fit_mode = menu_data.get("bg_fit_mode", "cover")

                # Fetch params - Align defaults changed to "center"
                align_x = menu_data.get("bg_align_x", "center")
                align_y = menu_data.get("bg_align_y", "center")

                # Use video_scale/bg_scale if available
                bg_scale = float(menu_data.get("video_scale", 1.0))

                custom_w = s(int(menu_data.get("bg_custom_width", 1000)))
                custom_h = s(int(menu_data.get("bg_custom_height", 1000)))

                # Calculate geometry
                new_w, new_h, px, py = _calculate_bg_layout(
                    bg_img.width, bg_img.height, fw, fh,
                    fit_mode, bg_scale, align_x, align_y,
                    custom_w, custom_h
                )

                # Resize (LANCZOS for static quality)
                bg_rz = bg_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

                # Paste
                final_img.paste(bg_rz, (px, py), bg_rz)
        except Exception as e:
            logger.error(f"Static BG Error: {e}")

    final_img.alpha_composite(layout_img)
    return final_img


# ==================================================================================
# LAYER 3: Animated Renderer (Streams to file)
# ==================================================================================
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

        # Config params - Fix logic to fallback to generic BG params if video params missing
        fit_mode = menu_data.get("bg_fit_mode", "cover")  # Changed default to 'cover'

        # FALLBACK LOGIC: If video_align_x/align missing, try bg_align_x/y
        # Added .get("video_align_y") check for legacy compatibility
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