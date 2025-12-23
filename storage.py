import json
import logging
import uuid
import shutil
from pathlib import Path
from typing import Dict, Any

# --- 路径常量 ---
BASE_DIR = Path(__file__).parent
BOT_ROOT = Path.cwd()
DATA_DIR = BOT_ROOT / "data" / "plugin_data" / "astrbot_plugin_custom_menu"

# 迁移旧数据
OLD_DATA_DIR = BASE_DIR / "data"
if OLD_DATA_DIR.exists() and not DATA_DIR.exists():
    try:
        shutil.copytree(OLD_DATA_DIR, DATA_DIR)
    except Exception:
        pass

ASSETS_DIR = DATA_DIR / "assets"
# --- FIX START: 定义缺失的路径变量 ---
BG_DIR = ASSETS_DIR / "backgrounds"
ICON_DIR = ASSETS_DIR / "icons"
IMG_DIR = ASSETS_DIR / "widgets"
# --- FIX END ---
MENU_FILE = DATA_DIR / "menu.json"
FONTS_DIR = BASE_DIR / "fonts"


def init_directories():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # 使用已定义的变量创建目录，保证一致性
    BG_DIR.mkdir(parents=True, exist_ok=True)
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    FONTS_DIR.mkdir(parents=True, exist_ok=True)


init_directories()


def create_default_menu(name="默认菜单"):
    return {
        "id": str(uuid.uuid4()),
        "enabled": True,
        "name": name,

        # --- 基础信息 ---
        "title": "功能菜单",
        "sub_title": "System Menu",
        "title_align": "center",

        # --- 画布 ---
        "use_canvas_size": False,
        "canvas_width": 1000,
        "canvas_height": 2000,
        "canvas_color": "#1e1e1e",
        "canvas_padding": 40,

        # --- 背景 ---
        "background": "",
        "bg_fit_mode": "cover_w",
        "bg_custom_width": 1000,
        "bg_custom_height": 1000,
        "bg_align_x": "center",
        "bg_align_y": "top",

        # --- 分组背景 ---
        "group_bg_color": "#000000",
        "group_bg_alpha": 50,
        "group_blur_radius": 0,

        # --- 功能项背景 (全模式通用) ---
        "item_bg_color": "#FFFFFF",
        "item_bg_alpha": 20,
        "item_blur_radius": 0,

        "layout_columns": 3,

        # --- 详细颜色配置 ---
        "title_color": "#FFFFFF",
        "subtitle_color": "#DDDDDD",
        "group_title_color": "#FFFFFF",
        "group_sub_color": "#AAAAAA",
        "item_name_color": "#FFFFFF",
        "item_desc_color": "#AAAAAA",

        # --- 详细字体配置 ---
        "title_font": "title.ttf",
        "group_title_font": "text.ttf",
        "group_sub_font": "text.ttf",
        "item_name_font": "title.ttf",
        "item_desc_font": "text.ttf",

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
                "free_mode": False,  # 分组独立自由模式开关
                "min_height": 0,
                "items": [
                    {"name": "帮助", "desc": "查看说明", "icon": "", "x": 20, "y": 60, "w": 280, "h": 100},
                    {"name": "状态", "desc": "系统状态", "icon": "", "x": 320, "y": 60, "w": 280, "h": 100}
                ]
            }
        ]
    }


DEFAULT_ROOT = {
    "version": 7,
    "menus": [create_default_menu()]
}


def load_config() -> Dict[str, Any]:
    if not MENU_FILE.exists():
        save_config(DEFAULT_ROOT)
        return DEFAULT_ROOT

    try:
        data = json.loads(MENU_FILE.read_text(encoding="utf-8"))

        # 简单迁移逻辑
        if "menus" in data:
            for m in data["menus"]:
                # 移除全局 free_edit_mode，确保每个 group 有 free_mode
                if "free_edit_mode" in m: del m["free_edit_mode"]

                if "group_bg_color" not in m: m["group_bg_color"] = m.get("box_bg_color", "#000000")
                if "item_bg_color" not in m: m["item_bg_color"] = "#FFFFFF"
                if "item_bg_alpha" not in m: m["item_bg_alpha"] = 20

                for g in m.get("groups", []):
                    if "free_mode" not in g: g["free_mode"] = False
                    if "min_height" not in g: g["min_height"] = 0
                    for item in g.get("items", []):
                        if "x" not in item: item["x"] = 0
                        if "y" not in item: item["y"] = 0
                        if "w" not in item: item["w"] = 0
                        if "h" not in item: item["h"] = 0

        elif "menus" not in data:
            old_menu = data
            def_m = create_default_menu()
            for k, v in def_m.items():
                if k not in old_menu: old_menu[k] = v
            new_root = {"version": 7, "menus": [old_menu]}
            save_config(new_root)
            return new_root

        return data
    except Exception as e:
        logging.error(f"加载配置失败: {e}")
        return DEFAULT_ROOT


def save_config(data: Dict[str, Any]):
    MENU_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def get_assets_list() -> Dict[str, list]:
    def scan(path: Path, exts: list):
        if not path.exists(): return []
        return [f.name for f in path.glob("*") if f.suffix.lower() in exts]

    return {
        "backgrounds": scan(BG_DIR, ['.png', '.jpg', '.jpeg']),
        "icons": scan(ICON_DIR, ['.png', '.jpg', '.jpeg']),
        "widget_imgs": scan(IMG_DIR, ['.png', '.jpg', '.jpeg', '.gif']),
        "fonts": scan(FONTS_DIR, ['.ttf', '.otf', '.ttc'])
    }