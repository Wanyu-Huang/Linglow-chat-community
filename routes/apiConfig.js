const express = require('express');
const router = express.Router();
const db = require('../config/database');

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: '未登录' });
  next();
};
router.use(requireAuth);

// 获取所有API配置
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, api_url, api_key, model_name, is_default, created_at FROM api_configs WHERE user_id = ? ORDER BY is_default DESC, id ASC',
      [req.session.userId]
    );
    res.json({ success: true, configs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新增API配置
router.post('/', async (req, res) => {
  try {
    const { name, apiUrl, apiKey, modelName, isDefault } = req.body;
    const userId = req.session.userId;
    if (!name || !apiKey) return res.status(400).json({ error: '名称和Key不能为空' });

    if (isDefault) {
      await db.query('UPDATE api_configs SET is_default = FALSE WHERE user_id = ?', [userId]);
    }

    const [result] = await db.query(
      'INSERT INTO api_configs (user_id, name, api_url, api_key, model_name, is_default) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, name, apiUrl || 'https://api.openai.com', apiKey, modelName || 'gpt-3.5-turbo', isDefault ? 1 : 0]
    );

    res.json({ success: true, id: result.insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新API配置
router.put('/:id', async (req, res) => {
  try {
    const { name, apiUrl, apiKey, modelName, isDefault } = req.body;
    const userId = req.session.userId;
    const configId = req.params.id;

    // 确认这条配置属于当前用户
    const [existing] = await db.query(
      'SELECT id FROM api_configs WHERE id = ? AND user_id = ?', [configId, userId]
    );
    if (!existing.length) return res.status(404).json({ error: '配置不存在' });

    if (isDefault) {
      await db.query('UPDATE api_configs SET is_default = FALSE WHERE user_id = ?', [userId]);
    }

    await db.query(
      'UPDATE api_configs SET name=?, api_url=?, api_key=?, model_name=?, is_default=?, updated_at=NOW() WHERE id=? AND user_id=?',
      [name, apiUrl || 'https://api.openai.com', apiKey, modelName || 'gpt-3.5-turbo', isDefault ? 1 : 0, configId, userId]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除API配置
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.session.userId;
    const configId = req.params.id;
    await db.query('DELETE FROM api_configs WHERE id = ? AND user_id = ?', [configId, userId]);
    // 如果有角色绑定了这个配置，清除绑定
    await db.query('UPDATE characters SET api_config_id = NULL WHERE api_config_id = ? AND user_id = ?', [configId, userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 设为默认
router.post('/:id/set-default', async (req, res) => {
  try {
    const userId = req.session.userId;
    const configId = req.params.id;
    await db.query('UPDATE api_configs SET is_default = FALSE WHERE user_id = ?', [userId]);
    await db.query('UPDATE api_configs SET is_default = TRUE WHERE id = ? AND user_id = ?', [configId, userId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 给角色绑定API配置
router.post('/bind-character', async (req, res) => {
  try {
    const { characterId, configId } = req.body;
    const userId = req.session.userId;
    await db.query(
      'UPDATE characters SET api_config_id = ? WHERE character_id = ? AND user_id = ?',
      [configId || null, characterId, userId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
