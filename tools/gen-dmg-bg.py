import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

WIDTH, HEIGHT = 660, 400

# 1. 创建高精画板
img = Image.new('RGBA', (WIDTH, HEIGHT), (15, 23, 42, 255))
draw = ImageDraw.Draw(img)

# 2. 绘制高端现代深色渐变背景 (Slate 950 -> Blue Slate 900)
for y in range(HEIGHT):
    factor = y / HEIGHT
    # 顶部略深邃，中间微亮，底部沉稳
    center_factor = 1.0 - abs(factor - 0.45) * 1.5
    center_factor = max(0.0, min(1.0, center_factor))
    
    r = int(11 + 12 * center_factor)
    g = int(18 + 16 * center_factor)
    b = int(32 + 24 * center_factor)
    draw.line([(0, y), (WIDTH, y)], fill=(r, g, b, 255))

# 3. 柔和的环境光晕 (多层发光)
glow_layer = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow_layer)

# 左侧 App 辉光 (180, 180) - Qshell 电光青辉光
glow_draw.ellipse([180 - 90, 180 - 90, 180 + 90, 180 + 90], fill=(56, 189, 248, 45))
# 右侧 Applications 辉光 (480, 180)
glow_draw.ellipse([480 - 90, 180 - 90, 480 + 90, 180 + 90], fill=(16, 185, 129, 35)) # 翡翠绿
# 中间流向能量场
glow_draw.ellipse([330 - 80, 180 - 40, 330 + 80, 180 + 40], fill=(99, 102, 241, 45)) # 蓝紫

glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(32))
img = Image.alpha_composite(img, glow_layer)
draw = ImageDraw.Draw(img)

# 4. 绘制优雅的圆角底座（macOS 风格圆角矩形，给图标精准的安放视效）
def draw_squircle_dock(x, y, size=116, radius=24, fill_color=(255, 255, 255, 10), border_color=(255, 255, 255, 25)):
    half = size / 2
    rect = [x - half, y - half, x + half, y + half]
    overlay = Image.new('RGBA', (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle(rect, radius=radius, fill=fill_color, outline=border_color, width=1)
    return overlay

img = Image.alpha_composite(img, draw_squircle_dock(180, 180))
img = Image.alpha_composite(img, draw_squircle_dock(480, 180))
draw = ImageDraw.Draw(img)

# 5. 绘制优雅的流线型发光导引箭头
arrow_y = 180
arrow_start_x = 265
arrow_end_x = 395

# 外发光线
draw.line([(arrow_start_x, arrow_y), (arrow_end_x - 14, arrow_y)], fill=(59, 130, 246, 90), width=6)
# 主线
draw.line([(arrow_start_x, arrow_y), (arrow_end_x - 14, arrow_y)], fill=(96, 165, 250, 200), width=3)
# 高亮核心线
draw.line([(arrow_start_x, arrow_y), (arrow_end_x - 14, arrow_y)], fill=(255, 255, 255, 240), width=1)

# 箭头头部（精细多边形）
head_pts = [
    (arrow_end_x, arrow_y),
    (arrow_end_x - 16, arrow_y - 10),
    (arrow_end_x - 11, arrow_y),
    (arrow_end_x - 16, arrow_y + 10)
]
draw.polygon(head_pts, fill=(224, 242, 254, 255))
draw.polygon([(arrow_end_x - 2, arrow_y), (arrow_end_x - 14, arrow_y - 8), (arrow_end_x - 10, arrow_y), (arrow_end_x - 14, arrow_y + 8)], fill=(255, 255, 255, 255))

# 6. 字体排版
font_candidates = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf"
]

font_title = None
for f in font_candidates:
    if os.path.exists(f):
        try:
            font_title = ImageFont.truetype(f, 23)
            font_sub = ImageFont.truetype(f, 13)
            font_hint = ImageFont.truetype(f, 11)
            font_desc = ImageFont.truetype(f, 13)
            font_label = ImageFont.truetype(f, 11)
            break
        except Exception:
            continue

# 顶部产品名称
title_text = "Qshell"
title_bbox = draw.textbbox((0, 0), title_text, font=font_title)
draw.text(((WIDTH - (title_bbox[2] - title_bbox[0])) / 2, 38), title_text, font=font_title, fill=(255, 255, 255, 255))

# 顶部副标题
sub_text = "现代化服务器管理工作台"
sub_bbox = draw.textbbox((0, 0), sub_text, font=font_sub)
draw.text(((WIDTH - (sub_bbox[2] - sub_bbox[0])) / 2, 70), sub_text, font=font_sub, fill=(148, 163, 184, 240))

# 箭头上方徽标提示
hint_text = "DRAG TO INSTALL"
hint_bbox = draw.textbbox((0, 0), hint_text, font=font_hint)
draw.text(((WIDTH - (hint_bbox[2] - hint_bbox[0])) / 2, arrow_y - 26), hint_text, font=font_hint, fill=(147, 197, 253, 230))

# 图标下方说明标签
app_label = "Qshell"
app_bbox = draw.textbbox((0, 0), app_label, font=font_label)
draw.text((180 - (app_bbox[2] - app_bbox[0]) / 2, 250), app_label, font=font_label, fill=(203, 213, 225, 210))

app_folder_label = "Applications"
folder_bbox = draw.textbbox((0, 0), app_folder_label, font=font_label)
draw.text((480 - (folder_bbox[2] - folder_bbox[0]) / 2, 250), app_folder_label, font=font_label, fill=(203, 213, 225, 210))

# 底部操作指引
desc_text = "拖拽 Qshell 到 Applications 文件夹即可完成安装"
desc_bbox = draw.textbbox((0, 0), desc_text, font=font_desc)
draw.text(((WIDTH - (desc_bbox[2] - desc_bbox[0])) / 2, 326), desc_text, font=font_desc, fill=(226, 232, 240, 230))

# 底部版权
copy_text = "Qshell Community"
copy_bbox = draw.textbbox((0, 0), copy_text, font=font_hint)
draw.text(((WIDTH - (copy_bbox[2] - copy_bbox[0])) / 2, 356), copy_text, font=font_hint, fill=(100, 116, 139, 180))

output_path = r"d:\SSHTOOL\tauri-app\src-tauri\icons\dmg-background.png"
img.save(output_path, "PNG")
print("Regenerated:", output_path)
