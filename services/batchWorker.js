/**
 * Batch AI Worker
 * 
 * 轮询 chat_sessions 表，找到"用户发了消息、等待时间已到、还没触发AI"的会话，
 * 拉取上下文 → 调AI → 拆段存库。
 * 
 * 前端只负责发消息入库（POST /api/chat/message），
 * 轮询 /api/chat/history/:id/poll 拿AI新消息渲染。
 */

const db = require('../config/database');
const { callAI } = require('./ai');
const { safeJsonParse } = require('./jsonHelper');
const sseHub = require('./sseHub');

// 防并发：正在处理中的 sessionKey 集合
const processing = new Set();

function sessionKey(userId, characterId) {
  return `${userId}:${characterId}`;
}

/**
 * 启动 batch worker，每秒检查一次
 */
function startBatchWorker() {
  setInterval(async () => {
    try {
      await processPendingSessions();
    } catch (e) {
      console.error('[BatchWorker] 轮询出错:', e.message);
    }
  }, 1000);
  console.log('✅ Batch AI worker started');
}

/**
 * 查找所有等待时间已到的会话并处理
 */
async function processPendingSessions() {
  // 找"未触发、最后用户消息时间已过等待窗口"的会话
  // wait_seconds 来自角色config里的 batchWaitTime，默认7秒
  const [sessions] = await db.query(`
    SELECT s.user_id, s.character_id, s.last_user_msg_at, s.wait_seconds, s.pending_count
    FROM chat_sessions s
    WHERE s.triggered = 0
      AND s.pending_count > 0
      AND TIMESTAMPDIFF(SECOND, s.last_user_msg_at, NOW()) >= s.wait_seconds
    LIMIT 10
  `);

  for (const session of sessions) {
    const key = sessionKey(session.user_id, session.character_id);
    if (processing.has(key)) continue;

    // 标记为"已触发"，防止重复处理
    const [updated] = await db.query(
      `UPDATE chat_sessions SET triggered = 1 WHERE user_id = ? AND character_id = ? AND triggered = 0`,
      [session.user_id, session.character_id]
    );
    if (updated.affectedRows === 0) continue; // 已被其他进程抢走

    processing.add(key);
    handleSession(session).finally(() => processing.delete(key));
  }
}

/**
 * 处理单个会话：构建上下文 → 调AI → 存库
 */
async function handleSession(session) {
  const { user_id: userId, character_id: characterId } = session;
  console.log(`[BatchWorker] 处理会话 userId=${userId} characterId=${characterId}`);

  try {
    // 1. 获取角色配置
    const [chars] = await db.query(
      'SELECT name, system_prompt, config, long_term_memory, api_config_id FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );
    if (chars.length === 0) return;
    const char = chars[0];
    const charConfig = safeJsonParse(char.config, {});
    const contextSize = charConfig.contextWindowSize || charConfig.maxContextMessages || 50;

    // 2. 拉取最近 N 条消息作为上下文
    const [histRows] = await db.query(
      `SELECT role, content, timestamp, seq FROM messages
       WHERE user_id = ? AND character_id = ?
       ORDER BY seq DESC, id DESC
       LIMIT ?`,
      [userId, characterId, contextSize]
    );
    histRows.reverse();

    // 3. 构建 system prompt（含长期记忆）
    let systemPrompt = char.system_prompt || '你是一个友好的AI助手。';
    const longTermMemory = safeJsonParse(char.long_term_memory, null);
    if (longTermMemory && longTermMemory.metadata) {
      let memoryText = '\n\n=== 长期记忆 ===\n';
      if (longTermMemory.basic_info && Object.keys(longTermMemory.basic_info).length > 0) {
        for (const [k, v] of Object.entries(longTermMemory.basic_info)) {
          memoryText += `${k}: ${v}\n`;
        }
      }
      if (longTermMemory.emotional_profile) {
        memoryText += `性格: ${longTermMemory.emotional_profile}\n`;
      }
      if (longTermMemory.important_events && longTermMemory.important_events.length > 0) {
        const sorted = [...longTermMemory.important_events].sort(
          (a, b) => new Date(b.last_mentioned) - new Date(a.last_mentioned)
        );
        memoryText += '\n以下是你的记忆片段（越靠前越重要）：\n';
        sorted.forEach((m, i) => {
          const date = new Date(m.last_mentioned).toLocaleDateString('zh-CN');
          memoryText += `${i + 1}. ${m.title}（${date}）\n${m.content}\n`;
          if (m['心路历程']) memoryText += `心路历程: ${m['心路历程']}\n`;
          memoryText += '\n';
        });
      }
      memoryText += '=== 记忆结束 ===\n';
      systemPrompt += memoryText;
    }

    // 当前时间
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false
    });
    systemPrompt += `\n\n[当前时间]: ${timeStr}`;

    // 4. 构建消息列表（含时间戳前缀）
    const messages = [
      { role: 'system', content: systemPrompt },
      ...histRows.map(row => {
        const t = row.timestamp ? new Date(row.timestamp) : null;
        const timePrefix = t ? `[${t.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}] ` : '';
        return { role: row.role, content: timePrefix + row.content };
      })
    ];

    // 5. 调AI前：推 typing 事件给前端（双勾 + 显示输入中）
    sseHub.push(userId, characterId, 'typing', { status: 'start' });

    // 6. 调AI
    const aiResponse = await callAI(userId, messages, null, characterId);

    // 7. 清理时间戳、拆段
    const timestampRegex = /^\s*\[\d{4}[\\/\-]\d{2}[\\/\-]\d{2}[\s\S]{0,20}?\d{2}:\d{2}[^\]]*\]\s*/;
    const cleaned = aiResponse.split('\n')
      .map(line => line.replace(timestampRegex, '').trim())
      .join('\n');
    const segments = cleaned.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    // 8. 存库 + 通过 SSE 推送给前端
    const [[{ baseSeq }]] = await db.query(
      'SELECT COALESCE(MAX(seq), -1) + 1 as baseSeq FROM messages WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );

    const aiTimestamp = new Date().toISOString();
    const baseAiId = `msg_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const savedSegments = [];
    for (let i = 0; i < segments.length; i++) {
      const segId = i === 0 ? baseAiId : `${baseAiId}_seg${i}`;
      const seq = baseSeq + i;
      await db.query(
        `INSERT IGNORE INTO messages (user_id, character_id, message_id, role, content, timestamp, seq)
         VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
        [userId, characterId, segId, segments[i], aiTimestamp, seq]
      );
      savedSegments.push({ id: segId, role: 'assistant', content: segments[i], timestamp: aiTimestamp, seq });
    }

    // SSE 推送：每条气泡单独推，前端收到后立即渲染
    for (const seg of savedSegments) {
      sseHub.push(userId, characterId, 'message', seg);
    }

    // 9. 减去本次处理的消息数（不清零！处理期间用户可能又发了新消息）
    const processedCount = session.pending_count;
    await db.query(
      'UPDATE chat_sessions SET pending_count = GREATEST(0, pending_count - ?) WHERE user_id = ? AND character_id = ?',
      [processedCount, userId, characterId]
    );

    // 10. 推送通知
    try {
      const charName = char.name || characterId;
      const { sendPushNotification } = require('./push');
      await sendPushNotification(userId, {
        title: charName,
        body: segments[0] ? (segments[0].length > 80 ? segments[0].slice(0, 80) + '…' : segments[0]) : '',
        tag: `reply-${userId}`,
        data: { url: '/' }
      });
    } catch (_) {}

    console.log(`[BatchWorker] ✅ 完成 userId=${userId} characterId=${characterId} segments=${segments.length}`);
  } catch (e) {
    console.error(`[BatchWorker] ❌ 处理失败 userId=${userId} characterId=${characterId}:`, e.message);
    // 失败时重置triggered=0，允许重试
    await db.query(
      'UPDATE chat_sessions SET triggered = 0 WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    ).catch(() => {});
  }
}

module.exports = { startBatchWorker };
