#!/usr/bin/env python3
"""
日志记录模块
为桌面应用提供日志记录功能，支持前后端日志统一记录
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.platforms.interface.service import PlatformService


def get_log_directory(platform_service: PlatformService) -> Path:
    """根据运行环境返回可写的日志目录"""
    # 1. 开发环境（未打包）
    if not getattr(sys, 'frozen', False):
        # 项目根目录：当前文件 backend/utils/logger.py -> 向上3级
        return Path(__file__).parent.parent.parent / 'logs'

    # 2. 打包后环境
    return platform_service.get_log_directory()

def setup_logger(platform_service: PlatformService, name: str = 'todolist',
                 level: int = logging.INFO, max_bytes: int = 10*1024*1024,
                 backup_count: int = 5) -> logging.Logger:
    """配置并返回logger实例
    
    Args:
        platform_service: 平台
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
    
    log_dir = get_log_directory(platform_service)
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

# 日志基类：集成该类便于调用日志方法
class LogManager:
    def __init__(self) -> None:
        from backend.platforms.core.factory import get_platform_service
        self.service: PlatformService = get_platform_service()
        self.get_logger = self.service.backend_logger()