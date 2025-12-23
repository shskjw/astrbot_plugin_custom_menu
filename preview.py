from astrbot.api import logger
from .renderer.menu import render_one_menu
from . import storage


def get_preview_file():
    """Dynamically get preview file path ensuring storage is initialized"""
    if storage.DATA_DIR is None:
        # Fallback if accessed before main init (unlikely but safe)
        storage.setup_paths()
    return storage.DATA_DIR / "preview.png"


def rebuild_preview():
    """触发渲染逻辑"""
    from .storage import load_config

    try:
        config = load_config()
        menus = config.get("menus", [])
        if not menus:
            logger.warning("No menus available for preview.")
            return

        # Render the first menu
        # render_one_menu takes a dict (menu_data), not a path
        img = render_one_menu(menus[0])

        target_file = get_preview_file()
        img.save(target_file)
    except Exception as e:
        logger.error(f"Render Error: {e}")


def get_latest_preview():
    target_file = get_preview_file()
    if not target_file.exists():
        rebuild_preview()
    return target_file