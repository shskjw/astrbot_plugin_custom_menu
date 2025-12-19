import json
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
ASSETS_DIR = DATA_DIR / "assets"
MENU_FILE = DATA_DIR / "menu.json"

# 初始化目录
DATA_DIR.mkdir(parents=True, exist_ok=True)
(ASSETS_DIR / "backgrounds").mkdir(parents=True, exist_ok=True)
(ASSETS_DIR / "icons").mkdir(parents=True, exist_ok=True)

# ⚠️ 新的数据结构：包含 groups
DEFAULT_MENU = {
    "title": "喵喵帮助",
    "sub_title": "Yunzai-Bot & Miao-Plugin",
    "title_color": "#ffffff",
    "background": "",
    "groups": [
        {
            "title": "常用功能",
            "items": [
                {"name": "#帮助", "desc": "查看帮助信息", "icon": ""},
                {"name": "#面板", "desc": "查看角色面板", "icon": ""}
            ]
        }
    ]
}

def load_menu() -> dict:
    if not MENU_FILE.exists():
        save_menu(DEFAULT_MENU)
        return DEFAULT_MENU
    try:
        return json.loads(MENU_FILE.read_text(encoding="utf-8"))
    except:
        return DEFAULT_MENU

def save_menu(data: dict):
    MENU_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

def get_assets_list():
    bg_dir = ASSETS_DIR / "backgrounds"
    icon_dir = ASSETS_DIR / "icons"
    return {
        "backgrounds": [f.name for f in bg_dir.glob("*") if f.suffix.lower() in ['.png', '.jpg', '.jpeg']],
        "icons": [f.name for f in icon_dir.glob("*") if f.suffix.lower() in ['.png', '.jpg', '.jpeg']]
    }