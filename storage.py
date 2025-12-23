import json
import uuid
import shutil
from pathlib import Path
from typing import Dict, Any

# AstrBot API
from astrbot.api.star import StarTools
from astrbot.api import logger

# --- Path Initialization ---
DATA_DIR = None
ASSETS_DIR = None
BG_DIR = None
ICON_DIR = None
IMG_DIR = None
MENU_FILE = None
FONTS_DIR = None
BASE_DIR = Path(__file__).parent


def setup_paths(custom_data_dir: str = None):
    """
    Explicitly initialize paths.
    Must be called by main.py (on_load) or web_server.py (process start).
    """
    global DATA_DIR, ASSETS_DIR, BG_DIR, ICON_DIR, IMG_DIR, MENU_FILE, FONTS_DIR

    if custom_data_dir:
        DATA_DIR = Path(custom_data_dir)
    else:
        # Use framework standard path
        DATA_DIR = StarTools.get_data_dir("astrbot_plugin_custom_menu")

    # Define sub-paths
    ASSETS_DIR = DATA_DIR / "assets"
    BG_DIR = ASSETS_DIR / "backgrounds"
    ICON_DIR = ASSETS_DIR / "icons"
    IMG_DIR = ASSETS_DIR / "widgets"
    MENU_FILE = DATA_DIR / "menu.json"
    FONTS_DIR = BASE_DIR / "fonts"

    # Migrate old data if exists
    OLD_DATA_DIR = BASE_DIR / "data"
    if OLD_DATA_DIR.exists() and not DATA_DIR.exists() and OLD_DATA_DIR != DATA_DIR:
        try:
            shutil.copytree(OLD_DATA_DIR, DATA_DIR)
        except Exception as e:
            logger.error(f"Migration failed: {e}")

    init_directories()


def init_directories():
    if DATA_DIR:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        BG_DIR.mkdir(parents=True, exist_ok=True)
        ICON_DIR.mkdir(parents=True, exist_ok=True)
        IMG_DIR.mkdir(parents=True, exist_ok=True)
        FONTS_DIR.mkdir(parents=True, exist_ok=True)


def create_default_menu(name="默认菜单"):
    return {
        "id": str(uuid.uuid4()),
        "enabled": True,
        "name": name,
        "title": "功能菜单",
        "sub_title": "System Menu",
        "title_align": "center",
        "use_canvas_size": False,
        "canvas_width": 1000,
        "canvas_height": 2000,
        "canvas_color": "#1e1e1e",
        "canvas_padding": 40,
        "export_scale": 1.0,
        "background": "",
        "bg_fit_mode": "cover_w",
        "bg_custom_width": 1000,
        "bg_custom_height": 1000,
        "bg_align_x": "center",
        "bg_align_y": "top",
        "group_bg_color": "#000000",
        "group_bg_alpha": 50,
        "group_blur_radius": 0,
        "item_bg_color": "#FFFFFF",
        "item_bg_alpha": 20,
        "item_blur_radius": 0,
        "layout_columns": 3,
        "title_color": "#FFFFFF",
        "subtitle_color": "#DDDDDD",
        "group_title_color": "#FFFFFF",
        "group_sub_color": "#AAAAAA",
        "item_name_color": "#FFFFFF",
        "item_desc_color": "#AAAAAA",
        "title_font": "title.ttf",
        "group_title_font": "text.ttf",
        "group_sub_font": "text.ttf",
        "item_name_font": "title.ttf",
        "item_desc_font": "text.ttf",
        "shadow_enabled": False,
        "shadow_color": "#000000",
        "shadow_offset_x": 2,
        "shadow_offset_y": 2,
        "shadow_radius": 2,
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
                "free_mode": False,
                "min_height": 0,
                "items": [
                    {"name": "帮助", "desc": "查看说明", "icon": "", "x": 20, "y": 60, "w": 280, "h": 100},
                    {"name": "状态", "desc": "系统状态", "icon": "", "x": 320, "y": 60, "w": 280, "h": 100}
                ]
            }
        ]
    }


DEFAULT_ROOT = {
    "version": 8,
    "menus": [create_default_menu()]
}


def load_config() -> Dict[str, Any]:
    # Ensure setup_paths has been called or handle None
    if not MENU_FILE or not MENU_FILE.exists():
        if MENU_FILE:  # If path set but file missing
            save_config(DEFAULT_ROOT)
        return DEFAULT_ROOT

    try:
        data = json.loads(MENU_FILE.read_text(encoding="utf-8"))
        # Simple structure check/migration could go here
        return data
    except Exception as e:
        logger.error(f"加载配置失败: {e}")
        return DEFAULT_ROOT


def save_config(data: Dict[str, Any]):
    if MENU_FILE:
        MENU_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def get_assets_list() -> Dict[str, list]:
    def scan(path: Path, exts: list):
        if not path or not path.exists(): return []
        return [f.name for f in path.glob("*") if f.suffix.lower() in exts]

    return {
        "backgrounds": scan(BG_DIR, ['.png', '.jpg', '.jpeg']),
        "icons": scan(ICON_DIR, ['.png', '.jpg', '.jpeg']),
        "widget_imgs": scan(IMG_DIR, ['.png', '.jpg', '.jpeg', '.gif']),
        "fonts": scan(FONTS_DIR, ['.ttf', '.otf', '.ttc'])
    }