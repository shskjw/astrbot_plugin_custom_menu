from PIL import Image, ImageFont, ImageDraw

def safe_font(font_path, size):
    try:
        return ImageFont.truetype(str(font_path), size)
    except OSError:
        # 如果找不到字体，尝试加载默认
        return ImageFont.load_default()

def safe_open_image(path, size=None):
    try:
        img = Image.open(path).convert("RGBA")
        if size:
            img = img.resize(size, Image.Resampling.LANCZOS)
        return img
    except (FileNotFoundError, OSError):
        # 创建一个半透明灰块代替缺失图片
        img = Image.new("RGBA", size if size else (50, 50), (128, 128, 128, 128))
        return img