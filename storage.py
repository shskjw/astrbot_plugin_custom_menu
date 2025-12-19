import json
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
ASSETS_DIR = DATA_DIR / "assets"
MENU_FILE = DATA_DIR / "menu.json"
# 暴露字体目录
FONTS_DIR = BASE_DIR / "fonts"

DATA_DIR.mkdir(parents=True, exist_ok=True)
(ASSETS_DIR / "backgrounds").mkdir(parents=True, exist_ok=True)
(ASSETS_DIR / "icons").mkdir(parents=True, exist_ok=True)
FONTS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_MENU = {
    "title": "功能菜单",
    "sub_title": "System Menu",
    "title_color": "#FFFFFF",
    "text_color": "#FFFFFF",
    # 新增默认字体配置
    "title_font": "title.ttf",
    "text_font": "text.ttf",
    "background": "",
    "groups": [
        {
            "title": "常用指令",
            "items": [
                {"name": "帮助", "desc": "查看说明", "icon": ""},
                {"name": "状态", "desc": "运行状态", "icon": ""}
            ]
        }
    ]
}

def load_menu():
    if not MENU_FILE.exists():
        save_menu(DEFAULT_MENU)
        return DEFAULT_MENU
    try:
        return json.loads(MENU_FILE.read_text("utf-8"))
    except:
        return DEFAULT_MENU

def save_menu(data):
    MENU_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")

def get_assets_list():
    bg_dir = ASSETS_DIR / "backgrounds"
    icon_dir = ASSETS_DIR / "icons"
    return {
        "backgrounds": [f.name for f in bg_dir.glob("*") if f.suffix.lower() in ['.png','.jpg','.jpeg']],
        "icons": [f.name for f in icon_dir.glob("*") if f.suffix.lower() in ['.png','.jpg','.jpeg']]
    }