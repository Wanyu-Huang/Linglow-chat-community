const express = require('express');
const db = require('../config/database');
const { callAI } = require('../services/ai');
const router = express.Router();

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
};

router.use(requireAuth);

router.get('/history/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;

    const [messages] = await db.query(
      `SELECT message_id as id, role, content, timestamp, status, metadata 
       FROM messages 
       WHERE user_id = ? AND character_id = ? 
       ORDER BY timestamp ASC`,
      [userId, characterId]
    );

    res.json({
      success: true,
      messages: messages.map(msg => ({
        ...msg,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : null
      }))
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { characterId, message, messageId } = req.body;
    const userId = req.session.userId;

    if (!characterId || !message || !messageId) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    await db.query(
      `INSERT INTO messages (user_id, character_id, message_id, role, content, status) 
       VALUES (?, ?, ?, 'user', ?, 2)`,
      [userId, characterId, messageId, message]
    );

    const [characters] = await db.query(
      'SELECT * FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    if (characters.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }

    const character = characters[0];

    const [history] = await db.query(
      `SELECT role, content FROM messages 
       WHERE user_id = ? AND character_id = ? 
       ORDER BY timestamp ASC 
       LIMIT 50`,
      [userId, characterId]
    );

    const systemPrompt = character.system_prompt || '你是一个友好的AI助手。';
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content }))
    ];

    const aiResponse = await callAI(userId, messages);

    const aiMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.query(
      `INSERT INTO messages (user_id, character_id, message_id, role, content, status) 
       VALUES (?, ?, ?, 'assistant', ?, 2)`,
      [userId, characterId, aiMessageId, aiResponse]
    );

    res.json({
      success: true,
      response: {
        id: aiMessageId,
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date().toISOString(),
        status: 2
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message || '发送消息失败' });
  }
});

router.delete('/message/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.session.userId;

    await db.query(
      'DELETE FROM messages WHERE user_id = ? AND message_id = ?',
      [userId, messageId]
    );

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

router.delete('/history/:characterId', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;

    await db.query(
      'DELETE FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    res.json({ success: true, message: '清空成功' });
  } catch (error) {
    console.error('Clear history error:', error);
    res.status(500).json({ error: '清空失败' });
  }
});

router.get('/favorites', async (req, res) => {
  try {
    const userId = req.session.userId;

    const [favorites] = await db.query(
      `SELECT favorite_id as id, character_id as characterId, sender_name as senderName, 
              content, favorited_at as favoritedAt, metadata 
       FROM favorites 
       WHERE user_id = ? 
       ORDER BY favorited_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      favorites: favorites.map(fav => ({
        ...fav,
        metadata: fav.metadata ? JSON.parse(fav.metadata) : null
      }))
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ error: '获取收藏失败' });
  }
});

router.post('/favorites', async (req, res) => {
  try {
    const { favoriteId, characterId, senderName, content } = req.body;
    const userId = req.session.userId;

    if (!favoriteId || !content) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    await db.query(
      `INSERT INTO favorites (user_id, favorite_id, character_id, sender_name, content) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, favoriteId, characterId, senderName, content]
    );

    res.json({ success: true, message: '收藏成功' });
  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({ error: '收藏失败' });
  }
});

router.delete('/favorites/:favoriteId', async (req, res) => {
  try {
    const { favoriteId } = req.params;
    const userId = req.session.userId;

    await db.query(
      'DELETE FROM favorites WHERE user_id = ? AND favorite_id = ?',
      [userId, favoriteId]
    );

    res.json({ success: true, message: '取消收藏成功' });
  } catch (error) {
    console.error('Delete favorite error:', error);
    res.status(500).json({ error: '删除收藏失败' });
  }
});

module.exports = router;
