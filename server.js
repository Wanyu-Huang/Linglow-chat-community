const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const characterRoutes = require('./routes/character');
const personaRoutes = require('./routes/persona');
const pushRoutes = require('./routes/push');
const configRoutes = require('./routes/config');
const apiConfigRoutes = require('./routes/apiConfig');
const db = require('./config/database');
const { startProactiveMessaging } = require('./services/proactiveMessage');
const { startSummaryWorker } = require('./services/summaryWorker');
const summaryTaskRoutes = require('./routes/summaryTask');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Session 持久化存入 MySQL
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'linglow_chat',
  createDatabaseTable: true,
  connectionLimit: 5,
  expiration: 7 * 24 * 60 * 60 * 1000,
  clearExpired: true,
  checkExpirationInterval: 60 * 60 * 1000
});

sessionStore.on('error', (err) => {
  console.error('Session store error:', err.message);
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'linglow-secret-key',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl} session.userId=${req.session ? req.session.userId : 'null'}`);
  next();
});

app.use('/api/auth',      authRoutes);
app.use('/api/chat',      chatRoutes);
app.use('/api/character', characterRoutes);
app.use('/api/persona',   personaRoutes);
app.use('/api/push',      pushRoutes);
app.use('/api/config',    configRoutes);
app.use('/api/api-configs', apiConfigRoutes);
app.use('/api/summary-task', summaryTaskRoutes);

// 诊断接口
app.get('/api/debug/status', async (req, res) => {
  try {
    const tableNames = ['users', 'user_config', 'characters', 'messages', 'favorites', 'user_personas', 'push_subscriptions', 'sessions'];
    const result = {};
    for (const t of tableNames) {
      try {
        const [rows] = await db.query(`SELECT COUNT(*) as cnt FROM \`${t}\``);
        result[t] = { exists: true, count: rows[0].cnt };
      } catch (e) {
        result[t] = { exists: false, error: e.message };
      }
    }
    // 检查messages表的列
    try {
      const [cols] = await db.query(`SHOW COLUMNS FROM messages`);
      result['messages_columns'] = cols.map(c => c.Field);
    } catch(e) {}
    // 显示每个角色最后5条消息的id，用于诊断导入截断问题
    try {
      const [chars] = await db.query(`SELECT DISTINCT character_id FROM messages LIMIT 5`);
      result['last_messages'] = {};
      for (const c of chars) {
        const [last] = await db.query(
          `SELECT message_id, role, LEFT(content,30) as preview FROM messages WHERE character_id = ? ORDER BY id DESC LIMIT 5`,
          [c.character_id]
        );
        result['last_messages'][c.character_id] = last;
      }
    } catch(e) { result['last_messages_error'] = e.message; }
    res.json({ ok: true, database: process.env.DB_NAME, tables: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── 自动建表 ──────────────────────────────────────────────────
async function ensureTables() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      nickname VARCHAR(100),
      avatar TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS user_config (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      api_key VARCHAR(255),
      api_base_url VARCHAR(255) DEFAULT 'https://api.openai.com',
      model_name VARCHAR(100) DEFAULT 'gpt-3.5-turbo',
      config JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_config (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS characters (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      character_id VARCHAR(100) NOT NULL,
      name VARCHAR(100) NOT NULL,
      avatar MEDIUMTEXT,
      system_prompt TEXT,
      first_message TEXT,
      config JSON,
      long_term_memory JSON,
      pending_summary JSON,
      favorites JSON,
      proactive_enabled BOOLEAN DEFAULT FALSE,
      proactive_interval_min INT DEFAULT 30,
      proactive_interval_max INT DEFAULT 60,
      proactive_quiet_start TIME DEFAULT NULL,
      proactive_quiet_end TIME DEFAULT NULL,
      last_proactive_time TIMESTAMP NULL,
      next_proactive_time TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_character (user_id, character_id),
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS messages (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      character_id VARCHAR(100) NOT NULL,
      message_id VARCHAR(100) UNIQUE NOT NULL,
      role ENUM('user', 'assistant') NOT NULL,
      content MEDIUMTEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(50) DEFAULT 'sent',
      metadata JSON,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_character (user_id, character_id),
      INDEX idx_timestamp (timestamp),
      INDEX idx_message_id (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS favorites (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      favorite_id VARCHAR(100) UNIQUE NOT NULL,
      character_id VARCHAR(100),
      sender_name VARCHAR(100),
      content MEDIUMTEXT NOT NULL,
      favorited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata JSON,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS api_configs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      api_url VARCHAR(500) DEFAULT 'https://api.openai.com',
      api_key VARCHAR(500) NOT NULL,
      model_name VARCHAR(100) DEFAULT 'gpt-3.5-turbo',
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS user_personas (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      persona_id VARCHAR(100) NOT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      avatar TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_persona (user_id, persona_id),
      INDEX idx_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  for (const sql of tables) {
    try {
      await db.query(sql);
    } catch (err) {
      console.error('ensureTables error:', err.message);
      throw err;
    }
  }
  console.log('✅ 所有数据表已就绪');
}

// ── 补全旧数据库缺失的列（兼容旧版MySQL，先检查再添加）──────────
async function ensureColumns() {
  // 先检查列是否存在，再决定是否ALTER，兼容不支持IF NOT EXISTS的MySQL版本
  async function addColumnIfMissing(table, column, definition) {
    try {
      const [cols] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      if (cols.length === 0) {
        await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`  ✅ 添加列: ${table}.${column}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ ${table}.${column}:`, err.message);
    }
  }

  async function modifyColumn(table, column, definition) {
    try {
      await db.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
    } catch (err) {
      console.warn(`  ⚠️ MODIFY ${table}.${column}:`, err.message);
    }
  }

  await addColumnIfMissing('messages', 'status', "VARCHAR(50) DEFAULT 'sent'");
  await addColumnIfMissing('messages', 'seq', 'INT DEFAULT 0');
  await addColumnIfMissing('messages', 'metadata', 'JSON');
  await addColumnIfMissing('characters', 'long_term_memory', 'JSON');
  await addColumnIfMissing('characters', 'pending_summary', 'JSON');
  await addColumnIfMissing('characters', 'favorites', 'JSON');
  await addColumnIfMissing('characters', 'proactive_enabled', 'BOOLEAN DEFAULT FALSE');
  await addColumnIfMissing('characters', 'proactive_interval_min', 'INT DEFAULT 30');
  await addColumnIfMissing('characters', 'proactive_interval_max', 'INT DEFAULT 60');
  await addColumnIfMissing('characters', 'proactive_quiet_start', 'TIME DEFAULT NULL');
  await addColumnIfMissing('characters', 'proactive_quiet_end', 'TIME DEFAULT NULL');
  await addColumnIfMissing('characters', 'last_proactive_time', 'TIMESTAMP NULL');
  await addColumnIfMissing('characters', 'next_proactive_time', 'TIMESTAMP NULL');

  // 把 TEXT 字段升级为 MEDIUMTEXT，支持超长 system_prompt
  await addColumnIfMissing('characters', 'api_config_id', 'INT DEFAULT NULL');
  await modifyColumn('characters', 'system_prompt', 'MEDIUMTEXT');
  await modifyColumn('characters', 'first_message', 'MEDIUMTEXT');

  // summary_tasks 表（已有DB兼容建表）
  await db.query(`CREATE TABLE IF NOT EXISTS summary_tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    character_id VARCHAR(255) NOT NULL,
    status ENUM('pending','running','paused','done','cancelled') DEFAULT 'pending',
    total_batches INT NOT NULL DEFAULT 0,
    current_batch INT NOT NULL DEFAULT 0,
    interval_size INT NOT NULL DEFAULT 200,
    task_data MEDIUMTEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_status (user_id, status),
    INDEX idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // messages 加 seq 索引（若没有）
  try {
    await db.query('CREATE INDEX idx_seq ON messages (user_id, character_id, seq)');
  } catch(e) { /* 已存在则忽略 */ }

  console.log('✅ 数据库列结构已验证');
}

// ── 初始化默认用户 ────────────────────────────────────────────
async function initializeDefaultUser() {
  try {
    const [rows] = await db.query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || '123456';
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync(password, 10);
      const [result] = await db.query(
        'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
        [username, hash]
      );
      await db.query(
        'INSERT INTO user_config (user_id, config) VALUES (?, ?)',
        [result.insertId, JSON.stringify({})]
      );
      console.log(`✅ 默认用户已创建: ${username}`);
    }
  } catch (err) {
    console.error('initializeDefaultUser error:', err.message);
  }
}

// ── 启动 ──────────────────────────────────────────────────────
async function startServer() {
  try {
    await db.query('SELECT 1');
    console.log('✅ 数据库连接成功');

    await ensureTables();
    await ensureColumns();
    await initializeDefaultUser();

    startProactiveMessaging();
    startSummaryWorker();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Linglow Chat 运行在端口 ${PORT}`);
      console.log(`🔍 诊断: http://localhost:${PORT}/api/debug/status`);
    });
  } catch (error) {
    console.error('❌ 启动失败:', error.message, '\n', error.stack);
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', () => { db.end(); process.exit(0); });
