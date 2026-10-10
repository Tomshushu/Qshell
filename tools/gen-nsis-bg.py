import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
icon_path = os.path.join(base_dir, 'src-tauri', 'icons', 'icon.png')
header_out = os.path.join(base_dir, 'src-tauri', 'icons', 'nsis-header.bmp')
sidebar_out = os.path.join(base_dir, 'src-tauri', 'icons', 'nsis-sidebar.bmp')

icon_src = Image.open(icon_path).convert('RGBA')

# 1. Generate nsis-header.bmp (150 x 57, 24-bit RGB BMP)
header = Image.new('RGB', (150, 57), (255, 255, 255))
icon_header = icon_src.resize((44, 44), Image.Resampling.LANCZOS)
header.paste(icon_header, (100, 6), icon_header)
header.save(header_out, 'BMP')
print('Regenerated:', header_out)

# 2. Generate nsis-sidebar.bmp (164 x 314, 24-bit RGB BMP)
sidebar = Image.new('RGBA', (164, 314), (15, 23, 42, 255))
draw = ImageDraw.Draw(sidebar)

for y in range(314):
    ratio = y / 314.0
    r = int(8 + 8 * ratio)
    g = int(21 + 10 * ratio)
    b = int(36 + 18 * ratio)
    draw.line([(0, y), (164, y)], fill=(r, g, b, 255))

glow = Image.new('RGBA', (164, 314), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse([82 - 50, 75 - 50, 82 + 50, 75 + 50], fill=(56, 189, 248, 60))
glow = glow.filter(ImageFilter.GaussianBlur(24))
sidebar = Image.alpha_composite(sidebar, glow)

icon_sidebar = icon_src.resize((72, 72), Image.Resampling.LANCZOS)
sidebar.paste(icon_sidebar, (82 - 36, 75 - 36), icon_sidebar)

draw_final = ImageDraw.Draw(sidebar)
font_bold = None
font_sub = None
for f in ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/arial.ttf']:
    if os.path.exists(f):
        try:
            font_bold = ImageFont.truetype(f, 15)
            font_sub = ImageFont.truetype(f, 10)
            break
        except Exception:
            pass

if font_bold and font_sub:
    t1 = 'Qshell'
    b1 = draw_final.textbbox((0, 0), t1, font=font_bold)
    draw_final.text(((164 - (b1[2] - b1[0])) // 2, 126), t1, font=font_bold, fill=(248, 250, 252, 240))

    t2 = 'Quick & Light'
    b2 = draw_final.textbbox((0, 0), t2, font=font_sub)
    draw_final.text(((164 - (b2[2] - b2[0])) // 2, 146), t2, font=font_sub, fill=(148, 163, 184, 200))

sidebar_rgb = sidebar.convert('RGB')
sidebar_rgb.save(sidebar_out, 'BMP')
print('Regenerated:', sidebar_out)
