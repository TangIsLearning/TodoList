#!/usr/bin/env python3
"""
全局变量
"""
# 设置全局窗口
window = None

# POSIX 平台单实例锁的文件描述符（进程存活期间需一直持有，否则锁会提前释放）
instance_lock_fd = None