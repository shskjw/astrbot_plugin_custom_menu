import asyncio
from astrbot.api import logger
from .renderer.menu import render_one_menu
from . import storage


def get_preview_file():
    """Dynamically get preview file path ensuring storage is initialized"""
    if storage.DATA_DIR is None:
        # Fallback if accessed before main init (unlikely but safe)
        storage.setup_paths()
    return storage.DATA_DIR / "preview.png"


def _rebuild_preview_sync():
    """
    Synchronous implementation of preview generation.
    Handles CPU-intensive rendering and File I/O.
    """
    from .storage import load_config

    try:
        config = load_config()
        menus = config.get("menus", [])
        if not menus:
            logger.warning("No menus available for preview.")
            return

        # Render the first menu
        img = render_one_menu(menus[0])

        target_file = get_preview_file()
        img.save(target_file)
        logger.info(f"Preview rebuilt at {target_file}")
    except Exception as e:
        logger.error(f"Render Error: {e}")


async def rebuild_preview():
    """
    Trigger rendering logic asynchronously.
    Wraps blocking calls in a thread to avoid blocking the event loop.
    """
    await asyncio.to_thread(_rebuild_preview_sync)


async def get_latest_preview():
    """
    Get the preview file path, rebuilding if necessary, asynchronously.
    """
    target_file = get_preview_file()
    if not target_file.exists():
        await rebuild_preview()
    return target_file