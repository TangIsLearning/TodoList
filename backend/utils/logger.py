#!/usr/bin/env python3
"""
日志记录模块
为桌面应用提供日志记录功能，支持前后端日志统一记录
"""

import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler

def get_log_directory():
    """根据运行环境返回可写的日志目录"""
    # 1. 开发环境（未打包）
    if not getattr(sys, 'frozen', False):
        # 项目根目录：当前文件 backend/utils/logger.py -> 向上3级
        return Path(__file__).parent.parent.parent / 'logs'

    # 2. 打包后环境
    from backend.platforms.core.factory import get_platform_service
    service = get_platform_service()
    return service.get_log_directory()


def setup_logger(name='todolist', level=logging.INFO, max_bytes=10*1024*1024, backup_count=5):
    """配置并返回logger实例
    
    Args:
        name: logger名称
        level: 日志级别，默认INFO
        max_bytes: 单个日志文件最大大小，默认10MB
        backup_count: 保留的日志文件备份数量，默认5个
    
    Returns:
        logging.Logger: 配置好的logger实例
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # 避免重复添加handler
    if logger.handlers:
        return logger
    
    log_dir = get_log_directory()
    log_file = log_dir / f'{name}.log'
    log_dir.mkdir(parents=True, exist_ok=True)
    # 创建文件handler
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding='utf-8'
    )
    file_handler.setLevel(level)
    
    # 创建控制台handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    
    # 设置日志格式
    formatter = logging.Formatter(
        '[%(asctime)s] [%(name)s] [%(levelname)s] [%(filename)s:%(lineno)d] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    # 添加handler到logger
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


def setup_frontend_logger(name='frontend', level=logging.INFO):
    """配置前端日志记录器
    
    前端日志会通过pywebview的API传递到后端进行记录
    
    Args:
        name: logger名称
        level: 日志级别，默认INFO
    
    Returns:
        logging.Logger: 配置好的logger实例
    """
    return setup_logger(name, level)


# 创建默认的logger实例
backend_logger = setup_logger('backend')
frontend_logger = setup_logger('frontend')
app_logger = setup_logger('app')


def log_frontend_message(level, message, source='frontend'):
    """记录从前端传来的日志消息
    
    Args:
        level: 日志级别（debug, info, warning, error, critical）
        message: 日志消息
        source: 日志来源
    """
    logger = frontend_logger
    level_map = {
        'debug': logger.debug,
        'info': logger.info,
        'warning': logger.warning,
        'error': logger.error,
        'critical': logger.critical
    }
    
    log_func = level_map.get(level.lower(), logger.info)
    log_func(f"[{source}] {message}")
