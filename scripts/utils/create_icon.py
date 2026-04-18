#!/usr/bin/env python3
"""
创建TodoList应用图标
如果没有PIL库，可以跳过此步骤
"""
try:
    from PIL import Image, ImageDraw

    def create_icon():
        """创建一个简单的TodoList图标"""
        # 创建256x256的图像
        size = 256
        img = Image.new('RGBA', (size, size), None)
        draw = ImageDraw.Draw(img)

        # 蓝色背景圆角矩形
        draw.rounded_rectangle([0, 0, size, size],
                               fill=(0, 123, 255, 255),
                               radius=int(size * 0.15))

        # 白色复选框
        box_size = 128
        box_x = (size - box_size) // 2
        box_y = (size - box_size) // 2
        draw.rounded_rectangle([box_x, box_y, box_x + box_size, box_y + box_size],
                               fill='white', outline='white',
                               width=3, radius=int(box_size * 0.15))

        # 使用圆角线条绘制对勾
        line_width = 16
        color = (0, 123, 255)

        # 第一段：左下到中间（略短一点，留出圆角空间）
        x1, y1 = box_x + 35, box_y + box_size // 2 + 5
        x2, y2 = box_x + 55, box_y + box_size - 35
        draw_line_with_round_caps(draw, x1, y1, x2, y2, line_width, color)

        # 第二段：中间到右上
        x3, y3 = box_x + box_size - 30, box_y + 40
        draw_line_with_round_caps(draw, x2, y2, x3, y3, line_width, color)

        img.save('todo_icon.ico', format='ICO', sizes=[(256 * 8, 256 * 8), (128 * 8, 128 * 8), (64 * 8, 64 * 8), (48 * 8, 48 * 8), (32 * 8, 32 * 8),
                        (16 * 8, 16 * 8)])
        print("✅ 图标创建成功: todo_icon.ico")

        preview_size = (256, 256)
        preview_img = img.resize(preview_size, Image.Resampling.LANCZOS)
        preview_img.save('todo_icon_preview.png', format='PNG')

    def draw_line_with_round_caps(draw, x1, y1, x2, y2, width, color):
        """绘制带圆头的线段"""
        import math

        # 计算线段的角度和长度
        dx = x2 - x1
        dy = y2 - y1
        length = math.sqrt(dx * dx + dy * dy)

        if length == 0:
            return

        # 单位方向向量
        ux = dx / length
        uy = dy / length

        # 垂直向量
        px = -uy
        py = ux

        # 半宽
        hw = width / 2

        # 矩形的四个角点
        corners = [
            (x1 + px * hw, y1 + py * hw),
            (x1 - px * hw, y1 - py * hw),
            (x2 - px * hw, y2 - py * hw),
            (x2 + px * hw, y2 + py * hw),
        ]

        # 绘制矩形主体
        draw.polygon(corners, fill=color)

        # 在两端绘制圆形端点
        draw.ellipse([x1 - hw, y1 - hw, x1 + hw, y1 + hw], fill=color)
        draw.ellipse([x2 - hw, y2 - hw, x2 + hw, y2 + hw], fill=color)

    if __name__ == '__main__':
        create_icon()

except ImportError:
    print("⚠️  未安装PIL库，跳过图标创建")
    print("如需创建图标，请运行: pip install Pillow")
except Exception as e:
    print(f"❌ 创建图标失败: {e}")