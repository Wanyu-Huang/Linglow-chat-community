-- Migration: 添加 seq 字段到 messages 表，新建 wallet 表
-- 在已有数据库上执行此脚本

-- 1. messages 表加 seq 字段（若已存在则跳过）
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS seq INT DEFAULT 0 COMMENT '消息顺序号，同角色内单调递增',
  ADD INDEX IF NOT EXISTS idx_user_char_seq (user_id, character_id, seq);

-- 2. 回填现有消息的 seq（按 id 升序赋值，保证顺序）
SET @prev_user := NULL;
SET @prev_char := NULL;
SET @seq_val   := 0;

UPDATE messages
SET seq = (@seq_val := IF(
    user_id = @prev_user AND character_id = @prev_char,
    @seq_val + 1,
    IF((@prev_user := user_id) IS NOT NULL AND (@prev_char := character_id) IS NOT NULL, 0, 0)
  ))
ORDER BY user_id, character_id, id ASC;

-- 3. 创建 wallets 表（余额）
CREATE TABLE IF NOT EXISTS wallets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL UNIQUE,
    balance DECIMAL(12,2) NOT NULL DEFAULT 200.00 COMMENT '当前余额',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 创建 wallet_transactions 表（流水）
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    character_id VARCHAR(100) COMMENT '相关角色（可空）',
    type ENUM('in','out') NOT NULL COMMENT 'in=收入 out=支出',
    amount DECIMAL(12,2) NOT NULL,
    note VARCHAR(255),
    from_name VARCHAR(100) COMMENT '对方名称',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
