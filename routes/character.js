const express = require('express');
const db = require('../config/database');
const { safeJsonParse, safeStringify } = require('../services/jsonHelper');
const router = express.Router();

const requireAuth = (req, res, next) => {
  // Debug log for authentication checks
  try {
    console.log('[AUTH] requireAuth check - session.userId =', req.session ? req.session.userId : null);
  } catch (e) {
    console.error('[AUTH] requireAuth log error:', e);
  }

  if (!req.session || !req.session.userId) {
    console.warn('[AUTH] Unauthorized request to', req.originalUrl);
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

router.use(requireAuth);

// ==================== 角色列表管理 ====================

// 获取所有角色
router.get('/list', async (req, res) => {
  try {
    console.log('[CHAR] GET /list - userId=', req.session.userId);
    const userId = req.session.userId;

    const [characters] = await db.query(
      `SELECT character_id, name, avatar, system_prompt, first_message,
              config, proactive_enabled, proactive_interval_min, proactive_interval_max,
              proactive_quiet_start, proactive_quiet_end, created_at, updated_at
       FROM characters 
       WHERE user_id = ? 
       ORDER BY updated_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      characters: characters.map(char => ({
        id: char.character_id,
        name: char.name,
        avatar: char.avatar,
        systemPrompt: char.system_prompt,
        firstMessage: char.first_message,
        config: safeJsonParse(char.config, {}),
        proactiveEnabled: char.proactive_enabled,
        proactiveIntervalMin: char.proactive_interval_min,
        proactiveIntervalMax: char.proactive_interval_max,
        proactiveQuietStart: char.proactive_quiet_start,
        proactiveQuietEnd: char.proactive_quiet_end,
        createdAt: char.created_at,
        updatedAt: char.updated_at
      }))
    });
  } catch (error) {
    console.error('Get characters error:', error);
    res.status(500).json({ error: '获取角色列表失败', detail: error.message });
  }
});

// 获取单个角色完整数据
router.get('/:characterId', async (req, res) => {
  try {
    console.log('[CHAR] GET /:characterId - params=', req.params, 'userId=', req.session.userId);
    const { characterId } = req.params;
    const userId = req.session.userId;

    const [characters] = await db.query(
      `SELECT * FROM characters WHERE user_id = ? AND character_id = ?`,
      [userId, characterId]
    );

    if (characters.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }

    const char = characters[0];

    res.json({
      success: true,
      character: {
        id: char.character_id,
        name: char.name,
        avatar: char.avatar,
        systemPrompt: char.system_prompt,
        firstMessage: char.first_message,
        config: safeJsonParse(char.config, {}),
        longTermMemory: safeJsonParse(char.long_term_memory, null),
        pendingSummary: safeJsonParse(char.pending_summary, []),
        favorites: safeJsonParse(char.favorites, []),
        proactiveEnabled: char.proactive_enabled,
        proactiveIntervalMin: char.proactive_interval_min,
        proactiveIntervalMax: char.proactive_interval_max,
        proactiveQuietStart: char.proactive_quiet_start,
        proactiveQuietEnd: char.proactive_quiet_end,
        api_config_id: char.api_config_id || null
      }
    });
  } catch (error) {
    console.error('Get character error:', error);
    res.status(500).json({ error: '获取角色失败', detail: error.message });
  }
});

// 创建或更新角色
router.post('/save', async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      characterId,
      name,
      avatar,
      systemPrompt,
      firstMessage,
      config,
      proactiveEnabled,
      proactiveIntervalMin,
      proactiveIntervalMax,
      proactiveQuietStart,
      proactiveQuietEnd
    } = req.body;

    console.log('[CHAR] POST /save - userId=', userId, 'characterId=', characterId, 'name=', name);

    if (!characterId || !name) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const [existing] = await db.query(
      'SELECT id FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // config 可能是对象或已序列化的字符串，统一处理
    const configJson = safeStringify(config, '{}');

    if (existing.length > 0) {
      await db.query(
        `UPDATE characters 
         SET name = ?, avatar = ?, system_prompt = ?, first_message = ?, config = ?,
             proactive_enabled = ?, proactive_interval_min = ?, proactive_interval_max = ?,
             proactive_quiet_start = ?, proactive_quiet_end = ?
         WHERE user_id = ? AND character_id = ?`,
        [
          name, avatar || null, systemPrompt || '', firstMessage || '', configJson,
          proactiveEnabled || false,
          proactiveIntervalMin || 30,
          proactiveIntervalMax || 60,
          proactiveQuietStart || null,
          proactiveQuietEnd || null,
          userId, characterId
        ]
      );
    } else {
      await db.query(
        `INSERT INTO characters 
         (user_id, character_id, name, avatar, system_prompt, first_message, config,
          proactive_enabled, proactive_interval_min, proactive_interval_max,
          proactive_quiet_start, proactive_quiet_end) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId, characterId, name, avatar || null, systemPrompt || '', firstMessage || '', configJson,
          proactiveEnabled || false,
          proactiveIntervalMin || 30,
          proactiveIntervalMax || 60,
          proactiveQuietStart || null,
          proactiveQuietEnd || null
        ]
      );
    }

    res.json({ success: true, message: '保存成功', characterId });
  } catch (error) {
    console.error('Save character error:', error.message);
    res.status(500).json({ error: '保存角色失败', detail: error.message });
  }
});

// 清空当前用户所有角色和聊天记录（用于导入前重置）
router.delete('/all', async (req, res) => {
  try {
    const userId = req.session.userId;
    console.log('[CHAR] DELETE /all - userId=', userId);

    // 先删消息，再删角色（外键约束）
    await db.query('DELETE FROM messages WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM characters WHERE user_id = ?', [userId]);

    res.json({ success: true, message: '已清空所有角色和聊天记录' });
  } catch (error) {
    console.error('Clear all characters error:', error);
    res.status(500).json({ error: '清空失败', detail: error.message });
  }
});

// 删除角色
router.delete('/:characterId', async (req, res) => {
  try {
    console.log('[CHAR] DELETE /:characterId - params=', req.params, 'userId=', req.session.userId);
    const { characterId } = req.params;
    const userId = req.session.userId;

    await db.query(
      'DELETE FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

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

// ==================== 角色数据管理（localStorage迁移）====================

// 保存长期记忆
router.post('/:characterId/memory', async (req, res) => {
  try {
    console.log('[CHAR] POST /:characterId/memory - params=', req.params, 'userId=', req.session.userId, 'bodyKeys=', Object.keys(req.body));
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { longTermMemory } = req.body;

    await db.query(
      'UPDATE characters SET long_term_memory = ? WHERE user_id = ? AND character_id = ?',
      [safeStringify(longTermMemory, null), userId, characterId]
    );

    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    console.error('Save memory error:', error);
    res.status(500).json({ error: '保存记忆失败' });
  }
});

// 保存待总结气泡
router.post('/:characterId/pending', async (req, res) => {
  try {
    console.log('[CHAR] POST /:characterId/pending - params=', req.params, 'userId=', req.session.userId, 'pendingLength=', (req.body.pendingSummary || []).length);
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { pendingSummary } = req.body;

    await db.query(
      'UPDATE characters SET pending_summary = ? WHERE user_id = ? AND character_id = ?',
      [safeStringify(pendingSummary, null), userId, characterId]
    );

    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    console.error('Save pending error:', error);
    res.status(500).json({ error: '保存待总结气泡失败' });
  }
});

// 保存收藏列表
router.post('/:characterId/favorites', async (req, res) => {
  try {
    console.log('[CHAR] POST /:characterId/favorites - params=', req.params, 'userId=', req.session.userId, 'favoritesLength=', (req.body.favorites || []).length);
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { favorites } = req.body;

    await db.query(
      'UPDATE characters SET favorites = ? WHERE user_id = ? AND character_id = ?',
      [safeStringify(favorites, null), userId, characterId]
    );

    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    console.error('Save favorites error:', error);
    res.status(500).json({ error: '保存收藏失败' });
  }
});

// 批量保存角色所有数据（chatHistory, memory, pending, favorites）
router.post('/:characterId/data', async (req, res) => {
  try {
    console.log('[CHAR] POST /:characterId/data - params=', req.params, 'userId=', req.session.userId, 'bodyKeys=', Object.keys(req.body));
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { longTermMemory, pendingSummary, favorites } = req.body;

    await db.query(
      `UPDATE characters 
       SET long_term_memory = ?, pending_summary = ?, favorites = ? 
       WHERE user_id = ? AND character_id = ?`,
      [
        safeStringify(longTermMemory, null),
        safeStringify(pendingSummary, null),
        safeStringify(favorites, null),
        userId,
        characterId
      ]
    );

    res.json({ success: true, message: '保存成功' });
  } catch (error) {
    console.error('Save character data error:', error);
    res.status(500).json({ error: '保存数据失败', detail: error.message });
  }
});

// ==================== 主动消息配置 ====================

// 更新主动消息配置
router.put('/:characterId/proactive', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;
    const {
      enabled,
      intervalMin,
      intervalMax,
      quietStart,
      quietEnd
    } = req.body;

    await db.query(
      `UPDATE characters 
       SET proactive_enabled = ?, 
           proactive_interval_min = ?, 
           proactive_interval_max = ?,
           proactive_quiet_start = ?,
           proactive_quiet_end = ?
       WHERE user_id = ? AND character_id = ?`,
      [
        enabled,
        intervalMin || 30,
        intervalMax || 60,
        quietStart || null,
        quietEnd || null,
        userId,
        characterId
      ]
    );

    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('Update proactive error:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 完整数据库导出（供迁移用）
router.get('/export/full', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: '未登录' });

  try {
    // 取所有角色
    const [chars] = await db.query(
      'SELECT * FROM characters WHERE user_id = ?', [userId]
    );

    const exportData = { version: '2.0', exportTime: new Date().toISOString(), data: {} };

    for (const char of chars) {
      const charId = char.character_id;
      const config = safeJsonParse(char.config, {});

      // 还原成前端格式的 config
      exportData.data[`char_${charId}_config`] = {
        ...config,
        systemPrompt: char.system_prompt || '',
        aiNickname: char.name || '',
        aiAvatar: char.avatar || null,
        firstMessage: char.first_message || ''
      };

      // 长期记忆
      exportData.data[`char_${charId}_longTermMemory`] = safeJsonParse(char.long_term_memory, null);
      exportData.data[`char_${charId}_pendingSummaryBubbles`] = safeJsonParse(char.pending_summary, []);

      // 聊天记录（全量，按seq排序）
      const [messages] = await db.query(
        `SELECT message_id as id, role, content, timestamp, seq, metadata
         FROM messages WHERE user_id = ? AND character_id = ?
         ORDER BY seq ASC, id ASC`,
        [userId, charId]
      );

      exportData.data[`char_${charId}_chatHistory`] = messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        metadata: safeJsonParse(m.metadata, null)
      }));
    }

    // 旧版api config（兼容）
    const [cfgs] = await db.query(
      'SELECT * FROM user_config WHERE user_id = ? LIMIT 1', [userId]
    );
    if (cfgs.length > 0) {
      exportData.data['aiChatConfig'] = {
        baseurl: cfgs[0].api_base_url || '',
        apikey: cfgs[0].api_key || '',
        modelname: cfgs[0].model_name || ''
      };
    }

    const filename = `db_backup_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);

  } catch(e) {
    console.error('Export error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
