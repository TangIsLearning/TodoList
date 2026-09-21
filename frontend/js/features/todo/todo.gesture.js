/**
 * 任务管理 - 任务行事件与移动端侧滑/拖拽手势（mixin）
 * 依赖：todo.js（TodoManager 类），须在 todo.js 之后加载
 */

Object.assign(TodoManager.prototype, {
    // 绑定任务事件（root 用于限定作用域，无限下拉追加时只处理新增节点）
    async bindTaskEvents(root = document) {
        const scope = root || document;
        const isFullBind = scope === document;

        // 先同步取快照：无限下拉追加时 scope 是游离容器，
        // 节点会在本次绑定的 await 期间就被搬进文档，届时再用 scope 查询会得到空集合，
        // 导致编辑/删除/子任务徽章等"await 之后绑定的元素"漏绑。
        const subtaskCountEls = Array.from(scope.querySelectorAll('.subtask-count'));
        const editButtons = Array.from(scope.querySelectorAll('.btn.edit'));
        const deleteButtons = Array.from(scope.querySelectorAll('.btn.delete'));
        const copyButtons = Array.from(scope.querySelectorAll('.task-copy-btn'));

        scope.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.toggleTask(taskId);
            };
        });

        scope.querySelectorAll('.btn.view').forEach(btn => {
            btn.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.viewTaskDetails(taskId);
            };
        });

        // 默认隐藏、悬浮任务行时显现
        copyButtons.forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this.copyTask(btn.dataset.taskId);
            };
            // 小屏卡片的侧滑手势从按下开始，点击图标时不应触发拖拽
            ['mousedown', 'touchstart'].forEach(type => {
                btn.addEventListener(type, (e) => e.stopPropagation());
            });
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
        if (isFullBind) this.instances = [];

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
                // 如果点击的是操作按钮区域或复选框，不触发拖拽
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 如果当前是打开状态，只关闭但不开始拖拽
                if (content._isOpen) {
                    content._isOpen = false;
                    content.style.left = '0px';
                    content.style.transition = 'left 0.2s ease';

                    const index = this.instances.indexOf(content);
                    if (index > -1) this.instances.splice(index, 1);

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

                if (state.currentX < -actionsWidth / 2) {
                    // 打开前关闭其他所有项
                    this.instances.forEach(instance => {
                        if (instance && instance !== content) {
                            instance.style.left = '0px';
                            instance.style.transition = 'left 0.2s ease';
                            instance._isOpen = false;
                        }
                    });

                    content._isOpen = true;
                    content.style.left = -actionsWidth + 'px';

                    this.instances = [content];
                } else {
                    content._isOpen = false;
                    content.style.left = '0px';

                    const index = this.instances.indexOf(content);
                    if (index > -1) this.instances.splice(index, 1);
                }

                state.currentX = 0;
                state.currentLeft = 0;

                preventDefault(e);
            };

            const clickHandler = (e) => {
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 打开状态下吞掉点击
                if (content._isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
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

        // 全局点击关闭（也要支持触摸）：只需绑定一次，避免无限下拉时重复叠加 document 监听
        if (!this._globalCloseHandlerBound) {
            const closeAllHandler = (e) => {
                if (!e.target.closest('.small-screen-task-item')) {
                    this.instances.forEach(instance => {
                        if (instance) {
                            instance.style.left = '0px';
                            instance.style.transition = 'left 0.2s ease';
                            instance._isOpen = false;
                        }
                    });
                    this.instances = [];
                }
            };

            document.addEventListener('click', closeAllHandler);
            document.addEventListener('touchstart', closeAllHandler);
            this._globalCloseHandlerBound = true;
        }

        // 绑定子任务数量徽章点击事件（同步绑定，使用快照）
        this.bindSubtaskCountEvents(subtaskCountEls);

        // 子任务数量需要请求接口，放在所有同步绑定之后：
        // await 之后的绑定一律使用快照，不能再依赖 scope 查询
        await this.loadSubtaskCounts(subtaskCountEls);

        // 添加CSS样式防止移动端默认行为（只注入一次）
        if (!document.getElementById('small-screen-task-style')) {
            const style = document.createElement('style');
            style.id = 'small-screen-task-style';
            style.textContent = `
            .small-screen-task-item {
                user-select: none;
                -webkit-user-select: none;
            }
            /* 不要给 .task-header 加 will-change: transform：合成层按设备像素对齐绘制，
               而外层操作区按小数坐标绘制，部分任务项会在卡片下边沿露出约 1px 操作按钮色。
               这里滑动用的是 left，will-change 也带不来性能收益。 */
        `;
            document.head.appendChild(style);
        }

        editButtons.forEach(btn => {
            const taskId = btn.dataset.taskId;
            const task = this.tasks.find(t => t.id === taskId);

            // 如果是周期性任务，禁用编辑按钮并添加点击提示
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
                    const taskId = e.target.dataset.taskId;
                    this.editTask(taskId);
                };
            }
        });

        deleteButtons.forEach(btn => {
            btn.onclick = async (e) => {
                const taskId = e.target.dataset.taskId;
                await this.deleteTask(taskId);
            };
        });
    },
});