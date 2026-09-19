/**
 * 分页控制器（大屏幕表格模式）：分页组件渲染、翻页、每页条数切换。
 * 小屏幕走无限下拉（infinite-scroll.js），分页仅在大屏幕启用。
 *
 * 依赖的 TodoManager 成员：
 *   状态：totalTasks / totalPages / currentPage / pageSize
 *   DOM：pagination / paginationShow / pageSizeSelect / paginationNum /
 *        firstBtn / prevBtn / nextBtn / lastBtn / tasksContainer
 *   方法：loadTasks；其它控制器：ctx.infiniteScroll.reset
 */
class PaginationController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    render() {
        const ctx = this.ctx;
        // 仅列表视图显示分页；日历/时间轴/统计等视图加载任务后隐藏，避免分页错位显示
        if (window.calendarManager && window.calendarManager.currentView !== 'list') {
            ctx.pagination.style.display = 'none';
            return;
        }
        if (ctx.totalTasks === 0) {
            ctx.pagination.style.display = 'none';
            return;
        }

        ctx.pagination.style.display = 'flex';

        const start = (ctx.currentPage - 1) * ctx.pageSize + 1;
        const end = Math.min(ctx.currentPage * ctx.pageSize, ctx.totalTasks);
        ctx.paginationShow.textContent =
            `${window.languageManager.getText('paginationShowing', '显示')} ${start}-${end} ${window.languageManager.getText('paginationOf', '共')} ${ctx.totalTasks} ${window.languageManager.getText('paginationItems', '条')}`;

        ctx.pageSizeSelect.value = ctx.pageSize;

        ctx.firstBtn.disabled = ctx.currentPage === 1;
        ctx.prevBtn.disabled = ctx.currentPage === 1;
        ctx.nextBtn.disabled = ctx.currentPage === ctx.totalPages;
        ctx.lastBtn.disabled = ctx.currentPage === ctx.totalPages;

        let pageNumbers = '';
        const maxButtons = 5; // 最多显示5个页码按钮

        if (ctx.totalPages <= maxButtons) {
            for (let i = 1; i <= ctx.totalPages; i++) {
                pageNumbers += `<button class="btn ${i === ctx.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
        } else if (ctx.currentPage <= 3) {           // 当前页靠前：1-4 + … + 末页
            for (let i = 1; i <= 4; i++) {
                pageNumbers += `<button class="btn ${i === ctx.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            pageNumbers += `<span class="pagination-ellipsis">...</span>`;
            pageNumbers += `<button class="btn" data-page="${ctx.totalPages}">${ctx.totalPages}</button>`;
        } else if (ctx.currentPage >= ctx.totalPages - 2) {  // 当前页靠后：1 + … + 末4页
            pageNumbers += `<button class="btn" data-page="1">1</button>`;
            pageNumbers += `<span class="pagination-ellipsis">...</span>`;
            for (let i = ctx.totalPages - 3; i <= ctx.totalPages; i++) {
                pageNumbers += `<button class="btn ${i === ctx.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
        } else {                                    // 当前页居中：1 + … + 前后各1页 + … + 末页
            pageNumbers += `<button class="btn" data-page="1">1</button>`;
            pageNumbers += `<span class="pagination-ellipsis">...</span>`;
            for (let i = ctx.currentPage - 1; i <= ctx.currentPage + 1; i++) {
                pageNumbers += `<button class="btn ${i === ctx.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
            pageNumbers += `<span class="pagination-ellipsis">...</span>`;
            pageNumbers += `<button class="btn" data-page="${ctx.totalPages}">${ctx.totalPages}</button>`;
        }

        ctx.paginationNum.innerHTML = pageNumbers;
        ctx.paginationNum.querySelectorAll('.btn').forEach(btn => {
            btn.onclick = () => {
                const page = parseInt(btn.dataset.page, 10);
                this.goToPage(page);
            };
        });
    }

    async goToPage(page) {
        const ctx = this.ctx;
        if (page < 1 || page > ctx.totalPages || page === ctx.currentPage) return;

        ctx.currentPage = page;
        await ctx.loadTasks();
        ctx.tasksContainer.scrollTop = 0;
    }

    async changePageSize(pageSize) {
        const ctx = this.ctx;
        if (pageSize === ctx.pageSize) return;

        ctx.pageSize = parseInt(pageSize);
        ctx.currentPage = 1;
        ctx.infiniteScroll.reset();
        await ctx.loadTasks();
    }
}
