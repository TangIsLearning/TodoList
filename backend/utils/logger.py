#!/usr/bin/env python3
"""
日志记录模块
为桌面应用提供日志记录功能，支持前后端日志统一记录
"""

import logging
import os
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler
from datetime import datetime


def get_log_directory():
    """获取日志文件存储目录
    
    对于打包后的exe文件，日志文件放在exe所在目录的logs文件夹
    对于开发环境，日志文件放在项目根目录的logs文件夹
    """
    if getattr(sys, 'frozen', False):
        # 打包后的exe环境
        exe_dir = Path(sys.executable).parent
    else:
        # 开发环境
        exe_dir = Path(__file__).parent.parent.parent
    
    log_dir = exe_dir / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


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
