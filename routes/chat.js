const express = require('express');
const { safeJsonParse, safeStringify } = require('../services/jsonHelper');
const db = require('../config/database');
const { callAI } = require('../services/ai');
const router = express.Router();
const webpush = require('web-push');

// 配置VAPID（从环境变量读取）
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// AI回复后向用户推送通知
async function pushReplyNotification(userId, characterName, firstSegment) {
  try {
    const [subs] = await db.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    if (subs.length === 0) return;

    const payload = JSON.stringify({
      title: characterName || 'Linglow',
      body: firstSegment.length > 80 ? firstSegment.slice(0, 80) + '…' : firstSegment,
      tag: `reply-${userId}`,
      data: { url: '/' }
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]);
        }
      }
    }
    console.log(`📲 推送通知已发送给用户 ${userId}`);
  } catch (e) {
    console.warn('推送通知失败:', e.message);
  }
}

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
    const limit = parseInt(req.query.limit) || 200;

    // 先取总数
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) as total FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // 默认返回最新 limit 条（按 seq/id DESC 取，然后反转成正序）
    const [messages] = await db.query(
      `SELECT message_id as id, role, content, timestamp, metadata,
              COALESCE(seq, id) as seq
       FROM messages
       WHERE user_id = ? AND character_id = ?
       ORDER BY COALESCE(seq, id) DESC
       LIMIT ?`,
      [userId, characterId, limit]
    );

    // 反转成正序（最老的在前）
    messages.reverse();

    res.json({
      success: true,
      total,
      returned: messages.length,
      messages: messages.map(msg => ({
        ...msg,
        metadata: safeJsonParse(msg.metadata, null)
      }))
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: '获取历史记录失败', detail: error.message });
  }
});

// 加载更老的消息（上滑懒加载用）
router.get('/history/:characterId/before', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;
    const limit = parseInt(req.query.limit) || 200;
    const beforeSeq = parseInt(req.query.beforeSeq) || 999999999;

    // 取 seq < beforeSeq 的最新 limit 条
    const [messages] = await db.query(
      `SELECT message_id as id, role, content, timestamp, metadata,
              COALESCE(seq, id) as seq
       FROM messages
       WHERE user_id = ? AND character_id = ? AND COALESCE(seq, id) < ?
       ORDER BY COALESCE(seq, id) DESC
       LIMIT ?`,
      [userId, characterId, beforeSeq, limit]
    );

    messages.reverse();

    res.json({
      success: true,
      messages: messages.map(msg => ({
        ...msg,
        metadata: safeJsonParse(msg.metadata, null)
      }))
    });
  } catch (error) {
    console.error('Get history before error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

// 前端发送用户消息：只存库 + 更新session，不调AI
// POST /api/chat/message  body: { characterId, messageId, content, waitSeconds? }
router.post('/message', async (req, res) => {
  try {
    const { characterId, messageId, content, waitSeconds } = req.body;
    const userId = req.session.userId;

    if (!characterId || !content) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const msgId = messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 取当前最大seq
    const [[{ baseSeq }]] = await db.query(
      'SELECT COALESCE(MAX(seq), -1) + 1 as baseSeq FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // 存消息
    await db.query(
      `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, seq)
       VALUES (?, ?, ?, 'user', ?, ?)`,
      [userId, characterId, msgId, content, baseSeq]
    );

    // 读角色config里的batchWaitTime（默认7）
    const wait = parseInt(waitSeconds) || 7;

    // upsert chat_sessions：每次用户发消息，重置计时（triggered=0，更新时间，累加pending_count）
    await db.query(
      `INSERT INTO chat_sessions (user_id, character_id, last_user_msg_at, pending_count, triggered, wait_seconds)
       VALUES (?, ?, NOW(), 1, 0, ?)
       ON DUPLICATE KEY UPDATE
         last_user_msg_at = NOW(),
         pending_count = pending_count + 1,
         triggered = 0,
         wait_seconds = VALUES(wait_seconds)`,
      [userId, characterId, wait]
    );

    res.json({ success: true, messageId: msgId, seq: baseSeq });
  } catch (e) {
    console.error('[CHAT] POST /message error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const sseHub = require('../services/sseHub');

// SSE 长连接：前端建立后，后端主动推新消息
// GET /api/chat/stream/:characterId?afterSeq=N
router.get('/stream/:characterId', (req, res) => {
  const { characterId } = req.params;
  const userId = req.session.userId;
  if (!userId) return res.status(401).end();

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 关闭 nginx 缓冲
  res.flushHeaders();

  // 注册连接
  sseHub.register(userId, characterId, res);

  // 发送心跳（每 25 秒），防止代理/浏览器超时断开
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 25000);

  // 客户端断开时清理
  req.on('close', () => {
    clearInterval(heartbeat);
    sseHub.unregister(userId, characterId, res);
  });
});

router.post('/send', async (req, res) => {
  try {
    const { characterId, message, messageId, messages } = req.body;
    const userId = req.session.userId;
    console.log('[CHAT] POST /send - userId=', userId, 'bodyKeys=', Object.keys(req.body));

    if (!characterId || !message || !messageId) {
      console.warn('[CHAT] POST /send missing params - body=', req.body);
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 取当前消息总数作为seq起点
    const [[{ msgCount }]] = await db.query(
      'SELECT COUNT(*) as msgCount FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // 支持批量用户消息：userMessages是数组（每条{id, content}），兼容旧版单条message
    const userMessages = req.body.userMessages;
    if (Array.isArray(userMessages) && userMessages.length > 0) {
      // 批量存所有用户消息
      for (let i = 0; i < userMessages.length; i++) {
        const um = userMessages[i];
        if (!um.id || !um.content) continue;
        await db.query(
          `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, seq) VALUES (?, ?, ?, 'user', ?, ?)`,
          [userId, characterId, um.id, um.content, msgCount + i]
        );
      }
    } else {
      // 兼容旧版单条
      await db.query(
        `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, seq) VALUES (?, ?, ?, 'user', ?, ?)`,
        [userId, characterId, messageId, message, msgCount]
      );
    }

    // 优先使用前端传来的 messages（含完整 system prompt + 长期记忆 + 历史）
    // 前端已经处理好了所有上下文，直接用
    let messagesToSend = messages;

    if (!messagesToSend || !Array.isArray(messagesToSend) || messagesToSend.length === 0) {
      // 降级：从数据库重建上下文
      console.log('⚠️ 前端未传 messages，降级从数据库重建上下文');
      const { safeJsonParse: sjp } = require('../services/jsonHelper');
      const [chars2] = await db.query(
        'SELECT * FROM characters WHERE user_id = ? AND character_id = ?',
        [userId, characterId]
      );
      if (chars2.length === 0) {
        return res.status(404).json({ error: '角色不存在' });
      }
      const char2 = chars2[0];
      const [history] = await db.query(
        `SELECT role, content FROM messages WHERE user_id = ? AND character_id = ? ORDER BY id DESC LIMIT 100`,
        [userId, characterId]
      );
      history.reverse();
      const basePrompt = char2.system_prompt || '你是一个友好的AI助手。';
      const longTermMemory = sjp(char2.long_term_memory, null);
      let systemContent = basePrompt;
      if (longTermMemory && longTermMemory.important_events && longTermMemory.important_events.length > 0) {
        const memoryText = longTermMemory.important_events
          .slice(-20).map(e => `- ${e.summary || e.content || JSON.stringify(e)}`).join('\n');
        systemContent += `\n\n【长期记忆】\n${memoryText}`;
      }
      messagesToSend = [
        { role: 'system', content: systemContent },
        ...history.map(h => ({ role: h.role, content: h.content }))
      ];
      console.log(`✅ 降级构建上下文: ${history.length}条历史 + 系统提示`);
    } else {
      console.log(`✅ 使用前端传来的上下文: ${messagesToSend.length}条消息`);
    }

    // 取角色名（用于推送通知）
    const [chars3] = await db.query(
      'SELECT name FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );
    if (chars3.length === 0) {
      return res.status(404).json({ error: '角色不存在' });
    }
    const character = chars3[0];

    // 调用AI（优先使用角色绑定的API配置）
    const aiResponse = await callAI(userId, messagesToSend, null, characterId);
    const aiTimestamp = new Date().toISOString();
    const baseAiId = req.body.aiMessageId || `msg_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 清理AI回复中可能被复读的时间戳前缀，再按 \n 切分存库
    const timestampRegex = /^\s*\[\d{4}[\/\-]\d{2}[\/\-]\d{2}[\s\S]{0,20}?\d{2}:\d{2}[^\]]*\]\s*/;
    const cleanedResponse = aiResponse.split('\n')
      .map(line => line.replace(timestampRegex, '').trim())
      .join('\n');
    const segments = cleanedResponse.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    // 取当前消息数作为seq起点
    const [[{ baseSeq }]] = await db.query(
      'SELECT COUNT(*) as baseSeq FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // 每段单独存库，id格式和前端一致
    const savedSegments = [];
    for (let i = 0; i < segments.length; i++) {
      const segId = i === 0 ? baseAiId : `${baseAiId}_seg${i}`;
      const seq = baseSeq + i;
      await db.query(
        `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, timestamp, seq) VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
        [userId, characterId, segId, segments[i], aiTimestamp, seq]
      );
      savedSegments.push({ id: segId, content: segments[i], timestamp: aiTimestamp });
    }

    // 先返回给前端（不等推送完成）
    res.json({
      success: true,
      segments: savedSegments,
      response: {
        id: baseAiId,
        role: 'assistant',
        content: aiResponse,
        timestamp: aiTimestamp
      }
    });

    // 异步推送通知（不阻塞返回）
    if (savedSegments.length > 0) {
      const charName = character.name || characterId;
      const firstLine = savedSegments[0].content;
      pushReplyNotification(userId, charName, firstLine).catch(() => {});
    }
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message || '发送消息失败' });
  }
});

router.delete('/message/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.session.userId;
    console.log('[CHAT] DELETE /message/:messageId - params=', req.params, 'userId=', userId);

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
    console.log('[CHAT] DELETE /history/:characterId - params=', req.params, 'userId=', userId);

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
        metadata: safeJsonParse(fav.metadata, null)
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

// 单条消息增量保存（用于实时聊天时的增量同步）
router.post('/history/:characterId/append', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { message } = req.body;

    if (!message || !message.role || !message.content) {
      return res.status(400).json({ error: '消息格式错误' });
    }

    const msgId = message.id || `auto_${characterId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // 取当前最大 seq，新消息续排
    const [[{ maxSeq }]] = await db.query(
      'SELECT COALESCE(MAX(COALESCE(seq, id)), -1) as maxSeq FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    await db.query(
      `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, metadata, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, characterId, msgId, message.role, message.content,
       safeStringify(message.metadata, null), maxSeq + 1]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Append message error:', error.message);
    res.status(500).json({ error: '保存失败', detail: error.message });
  }
});

// 批量保存聊天记录
router.post('/history/:characterId/batch', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;
    const { messages, mode } = req.body;

    console.log('[CHAT] batch save - characterId=', characterId, 'userId=', userId, 'count=', Array.isArray(messages) ? messages.length : 'invalid', 'mode=', mode);

    if (!Array.isArray(messages)) {
      console.error('[CHAT] batch: messages不是数组，类型=', typeof messages, '值=', JSON.stringify(messages)?.substring(0, 100));
      return res.status(400).json({ error: '消息格式错误' });
    }
    
    // 允许空数组（replace模式时清空后可能没有新消息）
    if (messages.length === 0 && mode !== 'replace') {
      return res.json({ success: true, message: '无消息需要保存', inserted: 0, skipped: 0 });
    }

    // replace 模式：先清空该角色的所有消息
    if (mode === 'replace') {
      await db.query('DELETE FROM messages WHERE user_id = ? AND character_id = ?', [userId, characterId]);
      console.log('[CHAT] replace mode: 已清空旧消息');
    }

    // 合并模式：不清空，逐条检查
    // 取当前库里该角色所有已有的 message_id → content 映射
    const [existing] = await db.query(
      'SELECT message_id, content FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );
    const existingMap = new Map(existing.map(r => [r.message_id, r.content]));

    // 取当前最大seq，新消息从这里续排
    const [[{ maxSeq }]] = await db.query(
      'SELECT COALESCE(MAX(seq), -1) as maxSeq FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    // 过滤并补全消息：跳过没有content/role的，自动补id
    const validMessages = messages
      .filter(msg => msg && msg.role && msg.content)
      .map((msg, idx) => ({
        id: msg.id || `imported_${characterId}_${idx}_${Date.now()}`,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata || null,
        timestamp: msg.timestamp || null,
        seq: idx
      }));

    // 分类：skip / insert-new / insert-conflict
    const toInsert = [];
    let seqOffset = maxSeq + 1;

    for (const msg of validMessages) {
      if (existingMap.has(msg.id)) {
        const existingContent = existingMap.get(msg.id);
        if (existingContent === msg.content) {
          // 完全相同 → 跳过
          continue;
        } else {
          // 同id不同内容 → 加后缀作为新消息
          toInsert.push({ ...msg, id: `${msg.id}_imported_${Date.now()}`, seq: seqOffset++ });
        }
      } else {
        // 新消息：seq从maxSeq续排，保证在已有消息之后
        toInsert.push({ ...msg, seq: maxSeq >= 0 ? seqOffset++ : msg.seq });
      }
    }

    if (toInsert.length > 0) {
      const BATCH_SIZE = 50;  // 每批50条，避免超过max_allowed_packet
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const values = batch.map(msg => [
          userId, characterId, msg.id, msg.role, msg.content,
          safeStringify(msg.metadata, null), msg.timestamp, msg.seq
        ]);
        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        await db.query(
          `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, metadata, timestamp, seq) VALUES ${placeholders}`,
          values.flat()
        );
      }
    }

    res.json({ success: true, message: '合并成功', inserted: toInsert.length, skipped: validMessages.length - toInsert.length });
  } catch (error) {
    console.error('Batch save history error:', error.message);
    res.status(500).json({ error: '批量保存失败', detail: error.message });
  }
});

// 轮询接口：前端每5秒调用，获取比 lastId 更新的消息
// GET /api/chat/history/:characterId/poll?afterId=xxx
router.get('/history/:characterId/poll', async (req, res) => {
  try {
    const { characterId } = req.params;
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ error: '未登录' });

    const afterSeq = parseInt(req.query.afterSeq) || 0;

    const [messages] = await db.query(
      `SELECT message_id as id, role, content, timestamp, seq
       FROM messages
       WHERE user_id = ? AND character_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT 50`,
      [userId, characterId, afterSeq]
    );

    res.json({ success: true, messages, count: messages.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
