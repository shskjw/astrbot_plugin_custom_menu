from pathlib import Path
from .renderer.menu import render_menu

BASE_DIR = Path(__file__).parent
PREVIEW_FILE = BASE_DIR / "data" / "preview.png"

def rebuild_preview():
    """触发渲染逻辑"""
    render_menu(PREVIEW_FILE)

def get_latest_preview():
    if not PREVIEW_FILE.exists():
        try:
            rebuild_preview()
        except Exception as e:
            print(f"Render Error: {e}")
            return None
    return PREVIEW_FILE