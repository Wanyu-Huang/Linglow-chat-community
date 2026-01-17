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

// 获取所有角色
router.get('/list', async (req, res) => {
  try {
    const userId = req.session.userId;

    const [characters] = await db.query(
      `SELECT character_id as id, name, ai_nickname as aiNickname, 
              user_nickname as userNickname, avatar, system_prompt as systemPrompt,
              first_message as firstMessage, proactive_enabled as proactiveEnabled,
              proactive_interval as proactiveInterval, last_proactive_time as lastProactiveTime,
              config, created_at as createdAt, updated_at as updatedAt
       FROM characters 
       WHERE user_id = ? 
       ORDER BY updated_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      characters: characters.map(char => ({
        ...char,
        config: char.config ? JSON.parse(char.config) : {}
      }))
    });
  } catch (error) {
    console.error('Get characters error:', error);
    res.status(500).json({ error: '获取角色列表失败' });
  }
});

// 获取单个角色
router.get('/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;

    const [characters] = await db.query(
      `SELECT character_id as id, name, ai_nickname as aiNickname, 
              user_nickname as userNickname, avatar, system_prompt as systemPrompt,
              first_message as firstMessage, proactive_enabled as proactiveEnabled,
              proactive_interval as proactiveInterval, last_proactive_time as lastProactiveTime,
              config, created_at as createdAt, updated_at as updatedAt
       FROM characters 
       WHERE user_id = ? AND character_id = ?`,
      [userId, characterId]
    );

    if (characters.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }

    const character = characters[0];
    character.config = character.config ? JSON.parse(character.config) : {};

    res.json({
      success: true,
      character
    });
  } catch (error) {
    console.error('Get character error:', error);
    res.status(500).json({ error: '获取角色失败' });
  }
});

// 创建或更新角色
router.post('/save', async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      characterId,
      name,
      aiNickname,
      userNickname,
      avatar,
      systemPrompt,
      firstMessage,
      proactiveEnabled,
      proactiveInterval,
      config
    } = req.body;

    if (!characterId || !name) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 检查是否已存在
    const [existing] = await db.query(
      'SELECT id FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    const configJson = JSON.stringify(config || {});

    if (existing.length > 0) {
      // 更新
      await db.query(
        `UPDATE characters 
         SET name = ?, ai_nickname = ?, user_nickname = ?, avatar = ?, 
             system_prompt = ?, first_message = ?, proactive_enabled = ?,
             proactive_interval = ?, config = ?
         WHERE user_id = ? AND character_id = ?`,
        [
          name,
          aiNickname,
          userNickname,
          avatar,
          systemPrompt,
          firstMessage,
          proactiveEnabled || false,
          proactiveInterval || 3600,
          configJson,
          userId,
          characterId
        ]
      );
    } else {
      // 创建
      await db.query(
        `INSERT INTO characters 
         (user_id, character_id, name, ai_nickname, user_nickname, avatar, 
          system_prompt, first_message, proactive_enabled, proactive_interval, config) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          characterId,
          name,
          aiNickname,
          userNickname,
          avatar,
          systemPrompt,
          firstMessage,
          proactiveEnabled || false,
          proactiveInterval || 3600,
          configJson
        ]
      );
    }

    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    console.error('Save character error:', error);
    res.status(500).json({ error: '保存角色失败' });
  }
});

// 删除角色
router.delete('/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;

    // 删除角色(会级联删除相关消息)
    await db.query(
      'DELETE FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // 删除相关消息
    await db.query(
      'DELETE FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('Delete character error:', error);
    res.status(500).json({ error: '删除角色失败' });
  }
});

// 更新主动消息配置
router.put('/:characterId/proactive', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { enabled, interval } = req.body;

    await db.query(
      `UPDATE characters 
       SET proactive_enabled = ?, proactive_interval = ? 
       WHERE user_id = ? AND character_id = ?`,
      [enabled, interval || 3600, userId, characterId]
    );

    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('Update proactive error:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 获取用户配置
router.get('/config/global', async (req, res) => {
  try {
    const userId = req.session.userId;

    const [configs] = await db.query(
      'SELECT api_key as apiKey, user_nickname as userNickname, user_avatar as userAvatar, config FROM user_config WHERE user_id = ?',
      [userId]
    );

    if (configs.length === 0) {
      // 创建默认配置
      await db.query(
        'INSERT INTO user_config (user_id, config) VALUES (?, ?)',
        [userId, JSON.stringify({})]
      );
      return res.json({
        success: true,
        config: {}
      });
    }

    const config = configs[0];
    config.config = config.config ? JSON.parse(config.config) : {};

    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 保存用户配置
router.post('/config/global', async (req, res) => {
  try {
    const userId = req.session.userId;
    const { apiKey, userNickname, userAvatar, config } = req.body;

    const configJson = JSON.stringify(config || {});

    // 检查是否存在
    const [existing] = await db.query(
      'SELECT id FROM user_config WHERE user_id = ?',
      [userId]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE user_config 
         SET api_key = ?, user_nickname = ?, user_avatar = ?, config = ? 
         WHERE user_id = ?`,
        [apiKey, userNickname, userAvatar, configJson, userId]
      );
    } else {
      await db.query(
        `INSERT INTO user_config (user_id, api_key, user_nickname, user_avatar, config) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, apiKey, userNickname, userAvatar, configJson]
      );
    }

    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    console.error('Save config error:', error);
    res.status(500).json({ error: '保存配置失败' });
  }
});

module.exports = router;
