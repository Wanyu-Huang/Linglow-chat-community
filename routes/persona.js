const express = require('express');
const db = require('../config/database');
const router = express.Router();

// 认证中间件
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

router.use(requireAuth);

// 获取所有人设
router.get('/', async (req, res) => {
  try {
    const userId = req.session.userId;

    const [personas] = await db.query(
      'SELECT persona_id, name, description, avatar, is_default FROM user_personas WHERE user_id = ? ORDER BY created_at ASC',
      [userId]
    );

    res.json({ success: true, personas });
  } catch (error) {
    console.error('Get personas error:', error);
    res.status(500).json({ error: '获取人设列表失败' });
  }
});

// 创建人设
router.post('/', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { personaId, name, description, avatar, isDefault } = req.body;

    if (!personaId || !name) {
      return res.status(400).json({ error: '人设ID和名称不能为空' });
    }

    // 如果设置为默认，先取消其他默认人设
    if (isDefault) {
      await db.query(
        'UPDATE user_personas SET is_default = FALSE WHERE user_id = ?',
        [userId]
      );
    }

    // 创建人设
    await db.query(
      'INSERT INTO user_personas (user_id, persona_id, name, description, avatar, is_default) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, personaId, name, description, avatar, isDefault || false]
    );

    res.json({ success: true, message: '创建成功', personaId });
  } catch (error) {
    console.error('Create persona error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '人设ID已存在' });
    }
    res.status(500).json({ error: '创建失败' });
  }
});

// 更新人设
router.put('/:personaId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { personaId } = req.params;
    const { name, description, avatar, isDefault } = req.body;

    // 如果设置为默认，先取消其他默认人设
    if (isDefault) {
      await db.query(
        'UPDATE user_personas SET is_default = FALSE WHERE user_id = ? AND persona_id != ?',
        [userId, personaId]
      );
    }

    // 更新人设
    await db.query(
      'UPDATE user_personas SET name = ?, description = ?, avatar = ?, is_default = ? WHERE user_id = ? AND persona_id = ?',
      [name, description, avatar, isDefault || false, userId, personaId]
    );

    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('Update persona error:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除人设
router.delete('/:personaId', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { personaId } = req.params;

    await db.query(
      'DELETE FROM user_personas WHERE user_id = ? AND persona_id = ?',
      [userId, personaId]
    );

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('Delete persona error:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

// 设置默认人设
router.post('/:personaId/set-default', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { personaId } = req.params;

    // 取消所有默认
    await db.query(
      'UPDATE user_personas SET is_default = FALSE WHERE user_id = ?',
      [userId]
    );

    // 设置新默认
    await db.query(
      'UPDATE user_personas SET is_default = TRUE WHERE user_id = ? AND persona_id = ?',
      [userId, personaId]
    );

    res.json({ success: true, message: '设置默认人设成功' });
  } catch (error) {
    console.error('Set default persona error:', error);
    res.status(500).json({ error: '设置失败' });
  }
});

// 获取默认人设
router.get('/default', async (req, res) => {
  try {
    const userId = req.session.userId;

    const [personas] = await db.query(
      'SELECT persona_id, name, description, avatar FROM user_personas WHERE user_id = ? AND is_default = TRUE LIMIT 1',
      [userId]
    );

    if (personas.length === 0) {
      return res.json({ success: true, persona: null });
    }

    res.json({ success: true, persona: personas[0] });
  } catch (error) {
    console.error('Get default persona error:', error);
    res.status(500).json({ error: '获取默认人设失败' });
  }
});

module.exports = router;
