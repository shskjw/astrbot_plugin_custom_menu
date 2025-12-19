import json
import logging
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
    FONTS_DIR.mkdir(parents=True, exist_ok=True)


init_directories()

# --- 默认配置结构 ---
DEFAULT_MENU = {
    # 基础信息
    "title": "功能菜单",
    "sub_title": "System Menu",
    "title_align": "center",  # left, center, right

    # 颜色配置
    "title_color": "#FFFFFF",
    "subtitle_color": "#DDDDDD",
    "group_title_color": "#FFFFFF",
    "item_name_color": "#FFFFFF",
    "item_desc_color": "#AAAAAA",
    "text_color": "#FFFFFF",  # 兜底通用色

    # 背景与布局
    "background": "",
    "layout_columns": 3,

    # 字体文件
    "title_font": "title.ttf",
    "text_font": "text.ttf",

    # 字号配置
    "title_size": 60,
    "group_title_size": 30,
    "item_name_size": 26,
    "item_desc_size": 16,

    # 自定义组件 (自由文本)
    "custom_widgets": [],

    # 默认分组
    "groups": [
        {
            "title": "常用指令",
            "items": [
                {"name": "帮助", "desc": "查看使用说明", "icon": ""},
                {"name": "状态", "desc": "查看运行状态", "icon": ""}
            ]
        }
    ]
}


def load_menu() -> Dict[str, Any]:
    """加载菜单配置，若不存在则创建默认配置"""
    if not MENU_FILE.exists():
        save_menu(DEFAULT_MENU)
        return DEFAULT_MENU
    try:
        return json.loads(MENU_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logging.error(f"加载菜单配置失败: {e}")
        return DEFAULT_MENU


def save_menu(data: Dict[str, Any]):
    """保存菜单配置到 JSON"""
    MENU_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def get_assets_list() -> Dict[str, list]:
    """扫描资源目录，返回文件列表"""

    def scan(path: Path, exts: list):
        return [f.name for f in path.glob("*") if f.suffix.lower() in exts]

    return {
        "backgrounds": scan(ASSETS_DIR / "backgrounds", ['.png', '.jpg', '.jpeg']),
        "icons": scan(ASSETS_DIR / "icons", ['.png', '.jpg', '.jpeg']),
        "fonts": scan(FONTS_DIR, ['.ttf', '.otf', '.ttc'])
    }