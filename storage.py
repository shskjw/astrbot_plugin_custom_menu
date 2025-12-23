import json
import uuid
import shutil
import sys
from pathlib import Path
from typing import Dict, Any, Optional

# AstrBot API
try:
    from astrbot.api.star import StarTools
    from astrbot.api import logger

    _HAS_ASTRBOT = True
except ImportError:
    _HAS_ASTRBOT = False
    import logging

    logger = logging.getLogger(__name__)


class PluginStorage:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(PluginStorage, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.base_dir = Path(__file__).parent
        self.data_dir: Optional[Path] = None
        self.assets_dir: Optional[Path] = None
        self.bg_dir: Optional[Path] = None
        self.icon_dir: Optional[Path] = None
        self.img_dir: Optional[Path] = None
        self.menu_file: Optional[Path] = None
        self.fonts_dir: Optional[Path] = None
        self._initialized = True

    def init_paths(self, custom_data_dir: str = None):
        """
        Initialize paths. Must be called explicitly.
        """
        if custom_data_dir:
            self.data_dir = Path(custom_data_dir)
        elif _HAS_ASTRBOT:
            # Use framework standard path
            self.data_dir = StarTools.get_data_dir("astrbot_plugin_custom_menu")
        else:
            self.data_dir = self.base_dir / "data"

        # Define sub-paths
        self.assets_dir = self.data_dir / "assets"
        self.bg_dir = self.assets_dir / "backgrounds"
        self.icon_dir = self.assets_dir / "icons"
        self.img_dir = self.assets_dir / "widgets"
        self.menu_file = self.data_dir / "menu.json"

        # --- 修改：字体路径迁移到 assets/fonts ---
        self.fonts_dir = self.assets_dir / "fonts"

        self._init_directories()

    def _init_directories(self):
        if self.data_dir:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.bg_dir.mkdir(parents=True, exist_ok=True)
            self.icon_dir.mkdir(parents=True, exist_ok=True)
            self.img_dir.mkdir(parents=True, exist_ok=True)
            self.fonts_dir.mkdir(parents=True, exist_ok=True)

            # --- 新增：复制默认字体到数据目录 ---
            # 这样用户既可以上传新字体，也能使用插件自带的默认字体
            source_fonts = self.base_dir / "fonts"
            if source_fonts.exists():
                for font_file in source_fonts.glob("*.*"):  # copy all files
                    target = self.fonts_dir / font_file.name
                    if not target.exists():
                        try:
                            shutil.copy(font_file, target)
                            logger.info(f"已初始化默认字体: {font_file.name}")
                        except Exception as e:
                            logger.warning(f"无法复制默认字体 {font_file.name}: {e}")

    def migrate_data(self):
        """
        Perform data migration. This involves file I/O and should be run in a thread.
        """
        old_data_dir = self.base_dir / "data"
        if old_data_dir.exists() and self.data_dir and not self.data_dir.exists():
            try:
                # Check if old_data_dir is not the same as new data_dir to avoid recursive copy errors
                if old_data_dir.resolve() != self.data_dir.resolve():
                    shutil.copytree(old_data_dir, self.data_dir, dirs_exist_ok=True)
                    logger.info("✅ 旧数据迁移完成")
            except Exception as e:
                logger.error(f"❌ 数据迁移失败: {e}")

    def create_default_menu(self, name="默认菜单"):
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

    def load_config(self) -> Dict[str, Any]:
        default_root = {"version": 8, "menus": [self.create_default_menu()]}

        if not self.menu_file or not self.menu_file.exists():
            if self.menu_file:
                self.save_config(default_root)
            return default_root

        try:
            data = json.loads(self.menu_file.read_text(encoding="utf-8"))
            return data
        except Exception as e:
            logger.error(f"加载配置失败: {e}")
            return default_root

    def save_config(self, data: Dict[str, Any]):
        if self.menu_file:
            self.menu_file.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8"
            )

    def get_assets_list(self) -> Dict[str, list]:
        def scan(path: Path, exts: list):
            if not path or not path.exists(): return []
            return [f.name for f in path.glob("*") if f.suffix.lower() in exts]

        return {
            "backgrounds": scan(self.bg_dir, ['.png', '.jpg', '.jpeg']),
            "icons": scan(self.icon_dir, ['.png', '.jpg', '.jpeg']),
            "widget_imgs": scan(self.img_dir, ['.png', '.jpg', '.jpeg', '.gif']),
            "fonts": scan(self.fonts_dir, ['.ttf', '.otf', '.ttc'])
        }


# --- 关键：必须实例化变量 ---
plugin_storage = PluginStorage()