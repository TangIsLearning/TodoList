/**
 * 行内交互控制器：任务行事件绑定 + 小屏幕左滑露出操作区的拖拽状态机。
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

        // scope 可能是游离容器（无限下拉追加时用的 temp）：调用方会在本函数 await 期间
        // 把节点搬进真实文档，之后再查 scope 就只能查到空集合。
        // 所以所有需要在 await 之后绑定的元素，都必须在这里先取成快照。
        const editButtons = Array.from(scope.querySelectorAll('.btn.edit'));
        const deleteButtons = Array.from(scope.querySelectorAll('.btn.delete'));
        const subtaskCountEls = Array.from(scope.querySelectorAll('.subtask-count'));

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
                content.style.left = '0px';
                content.style.transition = 'left 0.2s ease';
                content._isOpen = false;
            }

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

            content.style.left = '0px';
            content.style.position = 'relative';
            content._isOpen = false;

            const state = {
                isDragging: false,
                startX: 0,
                currentX: 0,
                currentLeft: 0,
                isOpen: false,
                startClientX: 0,
                startClientY: 0
            };

            const getClientX = (e) => {
                if (e.type.startsWith('touch')) return e.touches[0] ? e.touches[0].clientX : 0;
                return e.clientX;
            };

            const preventDefault = (e) => {
                if (e.cancelable) e.preventDefault();
            };

            const dragStartHandler = (e) => {
                // 点击操作按钮区域或复选框时不触发拖拽
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 已打开的项只关闭，不开始新一轮拖拽
                if (content._isOpen) {
                    content._isOpen = false;
                    content.style.left = '0px';
                    content.style.transition = 'left 0.2s ease';

                    const index = ctx.instances.indexOf(content);
                    if (index > -1) ctx.instances.splice(index, 1);

                    preventDefault(e);
                    e.stopPropagation();
                    return;
                }

                state.isDragging = true;
                state.startClientX = getClientX(e);
                state.startClientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                state.currentLeft = content.offsetLeft;
                state.currentX = 0;

                content.style.transition = 'none';
                // 暂时不阻止默认行为，等判断出是水平拖拽后再阻止
            };

            const dragMoveHandler = (e) => {
                if (!state.isDragging) return;

                const currentClientX = getClientX(e);
                if (currentClientX === 0) return; // 无效的触摸点

                const currentClientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                const deltaX = currentClientX - state.startClientX;
                const deltaY = currentClientY - state.startClientY;

                // 只有水平位移大于垂直位移时才认定为水平拖拽
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
                    // 垂直拖拽：不阻止默认行为，允许滚动
                    state.isDragging = false;
                }
            };

            const dragEndHandler = (e) => {
                if (!state.isDragging) return;

                state.isDragging = false;
                content.style.transition = 'left 0.2s ease';

                const actionsWidth = getActionsWidth();

                if (state.currentX < -actionsWidth / 2) {
                    // 打开前先关闭其他所有项（同一时刻只允许一项展开）
                    ctx.instances.forEach(instance => {
                        if (instance && instance !== content) {
                            instance.style.left = '0px';
                            instance.style.transition = 'left 0.2s ease';
                            instance._isOpen = false;
                        }
                    });

                    content._isOpen = true;
                    content.style.left = -actionsWidth + 'px';
                    ctx.instances = [content];
                } else {
                    content._isOpen = false;
                    content.style.left = '0px';

                    const index = ctx.instances.indexOf(content);
                    if (index > -1) ctx.instances.splice(index, 1);
                }

                state.currentX = 0;
                state.currentLeft = 0;

                preventDefault(e);
            };

            const clickHandler = (e) => {
                // 点击操作按钮区域或复选框时不处理
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 已展开状态下屏蔽点击，避免误触任务内容
                if (content._isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            };

            item._dragStartHandler = dragStartHandler;
            item._dragMoveHandler = dragMoveHandler;
            item._dragEndHandler = dragEndHandler;
            item._clickHandler = clickHandler;

            item.addEventListener('mousedown', dragStartHandler);
            item.addEventListener('mousemove', dragMoveHandler);
            item.addEventListener('mouseup', dragEndHandler);

            item.addEventListener('touchstart', dragStartHandler);
            item.addEventListener('touchmove', dragMoveHandler, { passive: false });
            item.addEventListener('touchend', dragEndHandler);
            item.addEventListener('touchcancel', dragEndHandler);

            item.addEventListener('click', clickHandler);
            item.addEventListener('dragstart', (e) => e.preventDefault());
        });

        // 全局点击关闭（也支持触摸）：只需绑定一次，避免无限下拉时重复叠加 document 监听
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
            document.addEventListener('touchstart', closeAllHandler);
            ctx._globalCloseHandlerBound = true;
        }

        // 删除/编辑按钮必须赶在子任务数量请求之前绑定：
        // 1) 无限下拉追加时 scope 是游离容器，await 期间节点已被搬进真实列表，再查 scope 只能查到空集合；
        // 2) 请求往返期间按钮处于未绑定状态，此时点击同样会"没反应"
        editButtons.forEach(btn => {
            const taskId = btn.dataset.taskId;
            const task = ctx.tasks.find(t => t.id === taskId);

            // 周期性任务禁用编辑，改为点击提示
            if (task && (task.isRecurring || task.parentTaskId)) {
                btn.disabled = true;
                btn.title = `${window.languageManager.getText('recurringTaskEditTip', '周期性任务不支持编辑')}`;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';

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

                btn.onclick = (e) => {
                    const id = e.target.dataset.taskId;
                    ctx.form.editTask(id);
                };
            }
        });

        deleteButtons.forEach(btn => {
            btn.onclick = async (e) => {
                const taskId = e.target.dataset.taskId;
                await ctx.actions.deleteTask(taskId);
            };
        });

        // 子任务数量只是锦上添花的信息：请求失败不应影响列表交互，因此吞掉异常
        try {
            await ctx.form.loadSubtaskCounts(subtaskCountEls);
        } catch (e) {
            logger.warn('加载子任务数量失败:', e);
        }
        ctx.form.bindSubtaskCountEvents(subtaskCountEls);

        // 注入 CSS 防止移动端默认行为（只注入一次）
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
    }
}
