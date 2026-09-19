/**
 * 行内交互控制器（小屏幕滑动操作）
 *
 * 从 TodoManager 中抽出：任务行的事件绑定与小屏幕左滑露出操作区的拖拽状态机。
 *
 * 迁移注意：原实现大量使用箭头函数，其中的 this 指向 TodoManager；
 * 搬入控制器后 this 指向本控制器，因此所有闭包内对管理器状态的读写
 * 一律改为通过 ctx 访问（instances / _globalCloseHandlerBound / tasks 等）。
 *
 * 依赖的 TodoManager 成员：
 *   状态：instances / _globalCloseHandlerBound / tasks
 *   其它控制器：ctx.actions.toggleTask / ctx.actions.deleteTask /
 *        ctx.form.editTask / ctx.form.loadSubtaskCounts / ctx.form.bindSubtaskCountEvents /
 *        ctx.detail.viewTaskDetails
 */
class RowInteractionsController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 绑定任务事件（root 用于限定作用域，无限下拉追加时只处理新增节点）
    async bindEvents(root = document) {
        const ctx = this.ctx;
        const scope = root || document;
        const isFullBind = scope === document;

        // 复选框点击
        scope.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                ctx.actions.toggleTask(taskId);
            };
        });

        // 查看详情按钮(仅大屏幕)
        scope.querySelectorAll('.btn.view').forEach(btn => {
            btn.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                ctx.detail.viewTaskDetails(taskId);
            };
        });

        // 全量绑定时先重置所有小屏幕任务项的样式，并解绑旧事件
        const itemsToBind = isFullBind
            ? scope.querySelectorAll('.small-screen-task-item')
            : [];

        Array.from(itemsToBind).forEach(item => {
            const content = item.querySelector('.task-header');
            if (content) {
                // 重置所有样式到初始状态
                content.style.left = '0px';
                content.style.transition = 'left 0.2s ease';
                content._isOpen = false;
            }

            // 移除之前绑定的所有事件（包括触摸事件）
            if (item._dragStartHandler) {
                item.removeEventListener('mousedown', item._dragStartHandler);
                item.removeEventListener('touchstart', item._dragStartHandler);
            }
            if (item._dragMoveHandler) {
                item.removeEventListener('mousemove', item._dragMoveHandler);
                item.removeEventListener('touchmove', item._dragMoveHandler);
            }
            if (item._dragEndHandler) {
                item.removeEventListener('mouseup', item._dragEndHandler);
                item.removeEventListener('touchend', item._dragEndHandler);
                item.removeEventListener('touchcancel', item._dragEndHandler);
            }
            if (item._clickHandler) item.removeEventListener('click', item._clickHandler);
        });

        // 全量绑定时清空实例数组（增量绑定时保留已打开项的引用）
        if (isFullBind) ctx.instances = [];

        // 重新绑定（增量绑定时只包含新增节点）
        Array.from(scope.querySelectorAll('.small-screen-task-item')).forEach(item => {
            const content = item.querySelector('.task-header');
            if (!content) return;

            const actions = item.querySelector('.task-actions');

            // 操作区宽度以实际渲染宽度为准（样式见 media.css 小屏幕下的 .task-actions），
            // 避免硬编码值与样式不一致导致滑动距离和操作区错位
            const getActionsWidth = () => {
                const width = actions ? actions.offsetWidth : 0;
                return width > 0 ? width : 80;
            };

            // 确保初始状态正确
            content.style.left = '0px';
            content.style.position = 'relative';
            content._isOpen = false;

            // 为每个item创建独立的状态
            const state = {
                isDragging: false,
                startX: 0,
                currentX: 0,
                currentLeft: 0,
                isOpen: false,
                startClientX: 0, // 用于存储触摸或鼠标的起始X坐标
                startClientY: 0  // 用于存储触摸或鼠标的起始Y坐标
            };

            // 获取客户端X坐标的统一函数
            const getClientX = (e) => {
                if (e.type.startsWith('touch')) return e.touches[0] ? e.touches[0].clientX : 0;
                return e.clientX;
            };

            // 阻止默认行为的统一函数
            const preventDefault = (e) => {
                if (e.cancelable) e.preventDefault();
            };

            // 创建事件处理函数
            const dragStartHandler = (e) => {
                // 如果点击的是操作按钮区域或复选框，不触发拖拽
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 如果当前是打开状态，只关闭但不开始拖拽
                if (content._isOpen) {
                    // 关闭当前项
                    content._isOpen = false;
                    content.style.left = '0px';
                    content.style.transition = 'left 0.2s ease';

                    // 从实例数组中移除
                    const index = ctx.instances.indexOf(content);
                    if (index > -1) ctx.instances.splice(index, 1);

                    preventDefault(e);
                    e.stopPropagation();
                    return;
                }

                // 开始拖拽
                state.isDragging = true;
                state.startClientX = getClientX(e);
                state.startClientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                state.currentLeft = content.offsetLeft;
                state.currentX = 0;

                content.style.transition = 'none';
                // 暂时不阻止默认行为，等判断是水平拖拽后再阻止
            };

            const dragMoveHandler = (e) => {
                if (!state.isDragging) return;

                const currentClientX = getClientX(e);
                if (currentClientX === 0) return; // 无效的触摸点

                const currentClientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                const deltaX = currentClientX - state.startClientX;
                const deltaY = currentClientY - state.startClientY;

                // 只有当水平拖拽距离大于垂直拖拽距离时，才认为是水平拖拽
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    preventDefault(e);

                    const actionsWidth = getActionsWidth();
                    let newLeft = state.currentLeft + deltaX;

                    // 边界限制
                    if (newLeft > 0) newLeft = 0;
                    if (newLeft < -actionsWidth) newLeft = -actionsWidth;

                    content.style.left = newLeft + 'px';
                    state.currentX = newLeft;
                } else {
                    // 垂直拖拽，不阻止默认行为，允许滚动
                    state.isDragging = false;
                }
            };

            const dragEndHandler = (e) => {
                if (!state.isDragging) return;

                state.isDragging = false;
                content.style.transition = 'left 0.2s ease';

                const actionsWidth = getActionsWidth();

                // 判断是否打开
                if (state.currentX < -actionsWidth / 2) {
                    // 打开前关闭其他所有项
                    ctx.instances.forEach(instance => {
                        if (instance && instance !== content) {
                            instance.style.left = '0px';
                            instance.style.transition = 'left 0.2s ease';
                            instance._isOpen = false;
                        }
                    });

                    // 打开当前项
                    content._isOpen = true;
                    content.style.left = -actionsWidth + 'px';

                    // 更新实例数组
                    ctx.instances = [content];
                } else {
                    // 关闭当前项
                    content._isOpen = false;
                    content.style.left = '0px';

                    // 从实例数组中移除
                    const index = ctx.instances.indexOf(content);
                    if (index > -1) ctx.instances.splice(index, 1);
                }

                // 重置拖拽状态
                state.currentX = 0;
                state.currentLeft = 0;

                preventDefault(e);
            };

            // 点击处理函数
            const clickHandler = (e) => {
                // 如果点击的是操作按钮区域或复选框，不处理
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 如果当前是打开状态，阻止点击事件
                if (content._isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            };

            // 存储事件处理函数
            item._dragStartHandler = dragStartHandler;
            item._dragMoveHandler = dragMoveHandler;
            item._dragEndHandler = dragEndHandler;
            item._clickHandler = clickHandler;

            // 绑定鼠标事件
            item.addEventListener('mousedown', dragStartHandler);
            item.addEventListener('mousemove', dragMoveHandler);
            item.addEventListener('mouseup', dragEndHandler);

            // 绑定触摸事件（移动端）
            item.addEventListener('touchstart', dragStartHandler);
            item.addEventListener('touchmove', dragMoveHandler, { passive: false });
            item.addEventListener('touchend', dragEndHandler);
            item.addEventListener('touchcancel', dragEndHandler);

            // 点击和原生拖拽阻止
            item.addEventListener('click', clickHandler);
            item.addEventListener('dragstart', (e) => e.preventDefault());
        });

        // 全局点击关闭（也要支持触摸）：只需绑定一次，避免无限下拉时重复叠加 document 监听
        if (!ctx._globalCloseHandlerBound) {
            const closeAllHandler = (e) => {
                if (!e.target.closest('.small-screen-task-item')) {
                    ctx.instances.forEach(instance => {
                        if (instance) {
                            instance.style.left = '0px';
                            instance.style.transition = 'left 0.2s ease';
                            instance._isOpen = false;
                        }
                    });
                    ctx.instances = [];
                }
            };

            document.addEventListener('click', closeAllHandler);
            document.addEventListener('touchstart', closeAllHandler); // 添加触摸支持
            ctx._globalCloseHandlerBound = true;
        }

        await ctx.form.loadSubtaskCounts(scope);

        // 绑定子任务数量徽章点击事件
        ctx.form.bindSubtaskCountEvents(scope);

        // 添加CSS样式防止移动端默认行为（只注入一次）
        if (!document.getElementById('small-screen-task-style')) {
            const style = document.createElement('style');
            style.id = 'small-screen-task-style';
            style.textContent = `
            .small-screen-task-item {
                user-select: none;
                -webkit-user-select: none;
            }
            /* 注意：不要再给 .task-header 加 will-change: transform。
               它会被提升为独立合成层，合成层的绘制边界按设备像素对齐，
               而外层操作区仍按精确的小数坐标绘制，于是部分任务项（高度取整后不凑巧的那些）
               会在卡片下边沿露出约 1px 的操作按钮颜色。
               这里滑动用的是 left（布局属性），will-change: transform 本来也不会带来任何性能收益。 */
        `;
            document.head.appendChild(style);
        }

        // 编辑按钮
        scope.querySelectorAll('.btn.edit').forEach(btn => {
            const taskId = btn.dataset.taskId;
            const task = ctx.tasks.find(t => t.id === taskId);

            // 如果是周期性任务，禁用编辑按钮并添加点击提示
            if (task && (task.isRecurring || task.parentTaskId)) {
                btn.disabled = true;
                btn.title = `${window.languageManager.getText('recurringTaskEditTip', '周期性任务不支持编辑')}`;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';

                // 设置点击事件处理，显示提示信息
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    Utils.showToast(window.languageManager.getText('periodicTaskEditFailed', '周期性任务不支持编辑，请删除后重新创建'), 'warning');
                };
            } else {
                btn.disabled = false;
                btn.title = `${window.languageManager.getText('normalTaskEditTip', '编辑')}`;
                btn.style.opacity = '';
                btn.style.cursor = '';

                // 设置编辑功能
                btn.onclick = (e) => {
                    const id = e.target.dataset.taskId;
                    ctx.form.editTask(id);
                };
            }
        });

        // 删除按钮
        scope.querySelectorAll('.btn.delete').forEach(btn => {
            btn.onclick = async (e) => {
                const taskId = e.target.dataset.taskId;
                await ctx.actions.deleteTask(taskId);
            };
        });
    }
}
