#!/bin/bash

# TodoList桌面应用安装脚本

echo "🚀 开始安装TodoList桌面应用..."

# 检查Python版本
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到Python3，请先安装Python 3.8或更高版本"
    exit 1
fi

python_version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
echo "✅ 找到Python版本: $python_version"

# 检查pip
if ! command -v pip3 &> /dev/null && ! command -v pip &> /dev/null; then
    echo "❌ 错误: 未找到pip，请先安装pip"
    exit 1
fi

# 创建虚拟环境（推荐）
echo "📦 创建虚拟环境..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✅ 虚拟环境创建成功"
else
    echo "ℹ️  虚拟环境已存在，跳过创建"
fi

# 激活虚拟环境
echo "🔧 激活虚拟环境..."
source venv/bin/activate

# 升级pip
echo "⬆️  升级pip..."
pip install --upgrade pip

# 安装依赖
echo "📚 安装依赖包..."
pip install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ 依赖安装成功"
else
    echo "❌ 依赖安装失败"
    exit 1
fi

# 创建启动脚本
echo "📝 创建启动脚本..."
cat > start.sh << 'EOF'
#!/bin/bash
# TodoList启动脚本

# 激活虚拟环境
source venv/bin/activate

# 启动应用
python run.py
EOF

chmod +x start.sh

# 测试运行（可选）
echo "🧪 是否要运行测试？(y/n)"
read -r run_test
if [ "$run_test" = "y" ] || [ "$run_test" = "Y" ]; then
    echo "🧪 运行后端测试..."
    python tests/test_backend.py
fi

echo ""
echo "🎉 安装完成！"
echo ""
echo "📖 使用说明:"
echo "   1. 运行应用: ./start.sh"
echo "   2. 或者直接运行: python run.py"
echo "   3. 在虚拟环境中运行: source venv/bin/activate && python run.py"
echo ""
echo "🌐 其他:"
echo "   - 前端测试: 打开 tests/test_frontend.html"
echo "   - 后端测试: python tests/test_backend.py"
echo "   - 项目文档: 查看 README.md"
echo ""