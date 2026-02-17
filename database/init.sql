-- Linglow Chat Community Edition - Database Schema

-- 用户表（保留完整结构，商业版也用）
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    avatar TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户人设表
CREATE TABLE IF NOT EXISTS user_personas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    persona_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL COMMENT '人设名称',
    description TEXT COMMENT '人设描述',
    avatar TEXT COMMENT '人设头像',
    is_default BOOLEAN DEFAULT FALSE COMMENT '是否为默认人设',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_persona (user_id, persona_id),
    INDEX idx_user_id (user_id),
    INDEX idx_default (user_id, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户配置表
CREATE TABLE IF NOT EXISTS user_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    api_key VARCHAR(255) COMMENT 'OpenAI API Key',
    api_base_url VARCHAR(255) DEFAULT 'https://api.openai.com' COMMENT 'API Base URL',
    model_name VARCHAR(100) DEFAULT 'gpt-3.5-turbo' COMMENT '模型名称',
    config JSON COMMENT '其他配置（contextWindowSize, batchWaitTime, apiTimeout等）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_config (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 角色配置表
CREATE TABLE IF NOT EXISTS characters (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    character_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL COMMENT '角色名称',
    avatar TEXT COMMENT '角色头像',
    system_prompt TEXT COMMENT '系统提示词',
    first_message TEXT COMMENT '首条消息',
    
    -- 角色配置
    config JSON COMMENT '角色完整配置（aiNickname, userNickname等）',
    
    -- 数据存储
    long_term_memory JSON COMMENT '长期记忆',
    pending_summary JSON COMMENT '待总结气泡',
    favorites JSON COMMENT '收藏列表',
    
    -- 主动消息配置
    proactive_enabled BOOLEAN DEFAULT FALSE COMMENT '是否启用主动消息',
    proactive_interval_min INT DEFAULT 30 COMMENT '主动消息最小间隔（分钟）',
    proactive_interval_max INT DEFAULT 60 COMMENT '主动消息最大间隔（分钟）',
    proactive_quiet_start TIME DEFAULT NULL COMMENT '静默时段开始时间',
    proactive_quiet_end TIME DEFAULT NULL COMMENT '静默时段结束时间',
    last_proactive_time TIMESTAMP NULL COMMENT '上次主动消息时间',
    next_proactive_time TIMESTAMP NULL COMMENT '下次主动消息时间',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_character (user_id, character_id),
    INDEX idx_user_id (user_id),
    INDEX idx_character_id (character_id),
    INDEX idx_proactive (proactive_enabled, next_proactive_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 聊天记录表
CREATE TABLE IF NOT EXISTS messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    character_id VARCHAR(100) NOT NULL,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSON COMMENT '消息元数据',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_character (user_id, character_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_message_id (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Push订阅表
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS summary_tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    character_id VARCHAR(255) NOT NULL,
    status ENUM('pending','running','paused','done','cancelled') DEFAULT 'pending',
    total_batches INT NOT NULL DEFAULT 0,
    current_batch INT NOT NULL DEFAULT 0,
    interval_size INT NOT NULL DEFAULT 200,
    task_data MEDIUMTEXT,           -- JSON：存 messageIds 数组
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_status (user_id, status),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
