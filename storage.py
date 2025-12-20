import json
import logging
import uuid
from pathlib import Path
from typing import Dict, Any

# --- 路径常量 ---
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
ASSETS_DIR = DATA_DIR / "assets"
MENU_FILE = DATA_DIR / "menu.json"
FONTS_DIR = BASE_DIR / "fonts"


# --- 初始化目录 ---
def init_directories():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (ASSETS_DIR / "backgrounds").mkdir(parents=True, exist_ok=True)
    (ASSETS_DIR / "icons").mkdir(parents=True, exist_ok=True)
    (ASSETS_DIR / "widgets").mkdir(parents=True, exist_ok=True)
    FONTS_DIR.mkdir(parents=True, exist_ok=True)


init_directories()


# --- 默认单菜单模板 ---
def create_default_menu(name="默认菜单"):
    return {
        "id": str(uuid.uuid4()),
        "enabled": True,
        "name": name,

        # 基础信息
        "title": "功能菜单",
        "sub_title": "System Menu",
        "title_align": "center",

        # --- 画布与导出设置 ---
        "use_canvas_size": False,
        "canvas_width": 1000,
        "canvas_height": 2000,
        "canvas_color": "#1e1e1e",
        "canvas_padding": 40,

        # --- 背景详细设置 ---
        "background": "",
        "bg_fit_mode": "cover_w",
        "bg_custom_width": 1000,
        "bg_custom_height": 1000,
        "bg_align_x": "center",
        "bg_align_y": "top",

        # 毛玻璃
        "box_bg_color": "#000000",
        "box_bg_alpha": 120,
        "box_blur_radius": 0,

        "layout_columns": 3,

        # --- 详细颜色配置 ---
        "title_color": "#FFFFFF",  # 主标题
        "subtitle_color": "#DDDDDD",  # 副标题
        "group_title_color": "#FFFFFF",  # 分组标题
        "group_sub_color": "#AAAAAA",  # 分组副标题
        "item_name_color": "#FFFFFF",  # 功能名
        "item_desc_color": "#AAAAAA",  # 描述

        # --- 详细字体配置 (新) ---
        "title_font": "title.ttf",  # 主标题/副标题 (默认)
        "group_title_font": "text.ttf",  # 分组标题 (新)
        "group_sub_font": "text.ttf",  # 分组副标题 (新)
        "item_name_font": "title.ttf",  # 功能名 (新)
        "item_desc_font": "text.ttf",  # 描述 (新)

        # 字号
        "title_size": 60,
        "group_title_size": 30,
        "group_sub_size": 18,
        "item_name_size": 26,
        "item_desc_size": 16,

        "custom_widgets": [],

        "groups": [
            {
                "title": "常用指令",
                "subtitle": "Basic",
                "items": [
                    {"name": "帮助", "desc": "查看使用说明", "icon": ""},
                    {"name": "状态", "desc": "查看运行状态", "icon": ""}
                ]
            }
        ]
    }


# --- 根配置结构 ---
DEFAULT_ROOT = {
    "version": 4,
    "menus": [create_default_menu()]
}


def load_config() -> Dict[str, Any]:
    if not MENU_FILE.exists():
        save_config(DEFAULT_ROOT)
        return DEFAULT_ROOT

    try:
        data = json.loads(MENU_FILE.read_text(encoding="utf-8"))

        # --- 数据迁移逻辑 ---
        if "menus" in data:
            for m in data["menus"]:
                # 补全新字体字段，默认沿用旧逻辑
                if "group_title_font" not in m: m["group_title_font"] = m.get("text_font", "text.ttf")
                if "group_sub_font" not in m: m["group_sub_font"] = m.get("text_font", "text.ttf")
                if "item_name_font" not in m: m["item_name_font"] = m.get("title_font", "title.ttf")
                if "item_desc_font" not in m: m["item_desc_font"] = m.get("text_font", "text.ttf")

        elif "menus" not in data:
            # 旧版迁移
            old_menu = data
            def_m = create_default_menu()
            for k, v in def_m.items():
                if k not in old_menu: old_menu[k] = v
            # 字体迁移
            old_menu["group_title_font"] = old_menu.get("text_font", "text.ttf")
            old_menu["group_sub_font"] = old_menu.get("text_font", "text.ttf")
            old_menu["item_name_font"] = old_menu.get("title_font", "title.ttf")
            old_menu["item_desc_font"] = old_menu.get("text_font", "text.ttf")

            new_root = {"version": 4, "menus": [old_menu]}
            save_config(new_root)
            return new_root

        return data
    except Exception as e:
        logging.error(f"加载菜单配置失败: {e}")
        return DEFAULT_ROOT


def save_config(data: Dict[str, Any]):
    MENU_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def get_assets_list() -> Dict[str, list]:
    def scan(path: Path, exts: list):
        return [f.name for f in path.glob("*") if f.suffix.lower() in exts]

    return {
        "backgrounds": scan(ASSETS_DIR / "backgrounds", ['.png', '.jpg', '.jpeg']),
        "icons": scan(ASSETS_DIR / "icons", ['.png', '.jpg', '.jpeg']),
        "widget_imgs": scan(ASSETS_DIR / "widgets", ['.png', '.jpg', '.jpeg', '.gif']),
        "fonts": scan(FONTS_DIR, ['.ttf', '.otf', '.ttc'])
    }