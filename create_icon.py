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
        img = Image.new('RGBA', (size, size), (0, 123, 255, 255))  # 蓝色背景
        draw = ImageDraw.Draw(img)
        
        # 绘制简单的待办事项图标
        # 绘制白色复选框
        box_size = 128
        box_x = (size - box_size) // 2
        box_y = (size - box_size) // 2
        
        # 外框
        draw.rectangle([box_x, box_y, box_x + box_size, box_y + box_size], 
                     fill='white', outline='white', width=3)

        # 绘制对勾
        check_points = [
            (box_x + 20, box_y + box_size // 2),
            (box_x + 45, box_y + box_size - 20),
            (box_x + box_size - 20, box_y + 20)
        ]
        draw.line(check_points, fill=(0, 123, 255), width=8)
        
        # 保存为ICO文件
        img.save('todo_icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
        print("✅ 图标创建成功: todo_icon.ico")
        return True
    
    if __name__ == '__main__':
        create_icon()
        
except ImportError:
    print("⚠️  未安装PIL库，跳过图标创建")
    print("如需创建图标，请运行: pip install Pillow")
except Exception as e:
    print(f"❌ 创建图标失败: {e}")