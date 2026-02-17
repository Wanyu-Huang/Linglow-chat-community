const cron = require('node-cron');
const db = require('../config/database');
const { callAI } = require('./ai');
const { sendPushNotification } = require('./push');

/**
 * 检查是否在静默时段
 */
function isInQuietHours(quietStart, quietEnd) {
  if (!quietStart || !quietEnd) {
    return false;
  }

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes(); // 当前分钟数

  const [startHour, startMin] = quietStart.split(':').map(Number);
  const [endHour, endMin] = quietEnd.split(':').map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // 处理跨日情况（例如 23:00 - 07:00）
  if (startMinutes > endMinutes) {
    return currentTime >= startMinutes || currentTime < endMinutes;
  } else {
    return currentTime >= startMinutes && currentTime < endMinutes;
  }
}

/**
 * 生成随机间隔（分钟）
 */
function generateRandomInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 计算下次发送时间
 */
function calculateNextTime(intervalMin, intervalMax) {
  const randomMinutes = generateRandomInterval(intervalMin, intervalMax);
  const nextTime = new Date(Date.now() + randomMinutes * 60 * 1000);
  return nextTime;
}

/**
 * 启动主动消息定时任务（每分钟检查一次）
 */
function startProactiveMessaging() {
  cron.schedule('* * * * *', async () => {
    try {
      await checkAndSendProactiveMessages();
    } catch (error) {
      console.error('Proactive messaging error:', error);
    }
  });

  console.log('✅ Proactive messaging scheduler started');
}

/**
 * 检查并发送主动消息
 */
async function checkAndSendProactiveMessages() {
  try {
    // 查找需要发送主动消息的角色
    const [characters] = await db.query(
      `SELECT c.id, c.user_id, c.character_id, c.name, c.avatar, c.system_prompt,
              c.proactive_interval_min, c.proactive_interval_max,
              c.proactive_quiet_start, c.proactive_quiet_end,
              c.next_proactive_time, c.config
       FROM characters c
       WHERE c.proactive_enabled = 1
       AND (
         c.next_proactive_time IS NULL 
         OR c.next_proactive_time <= NOW()
       )`
    );

    if (characters.length === 0) {
      return;
    }

    console.log(`📤 Found ${characters.length} characters ready for proactive messaging`);

    for (const character of characters) {
      try {
        await sendProactiveMessage(character);
      } catch (error) {
        console.error(`Error sending proactive message for character ${character.character_id}:`, error);
      }
    }
  } catch (error) {
    console.error('Check proactive messages error:', error);
  }
}

/**
 * 发送单个主动消息
 */
async function sendProactiveMessage(character) {
  try {
    const userId = character.user_id;
    const characterId = character.character_id;

    // 检查是否在静默时段
    if (isInQuietHours(character.proactive_quiet_start, character.proactive_quiet_end)) {
      console.log(`⏸️  Character ${character.name} in quiet hours, skipping...`);
      
      // 计算下次发送时间（10分钟后再检查）
      const nextTime = new Date(Date.now() + 10 * 60 * 1000);
      await db.query(
        'UPDATE characters SET next_proactive_time = ? WHERE id = ?',
        [nextTime, character.id]
      );
      return;
    }

    console.log(`📤 Sending proactive message for character: ${character.name} (user: ${userId})`);

    // 获取最近的对话历史
    const [recentMessages] = await db.query(
      `SELECT role, content FROM messages 
       WHERE user_id = ? AND character_id = ? 
       ORDER BY timestamp DESC 
       LIMIT 10`,
      [userId, characterId]
    );

    const history = recentMessages.reverse().map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 构建系统提示（要求主动发消息）
    const systemPrompt = `【系统提示】
你现在需要主动发起一条消息给用户。

【角色设定】
${character.system_prompt || '你是一个友好的AI助手。'}

【要求】
1. 完全以角色的身份和口吻说话
2. 可以是：问候、分享想法、询问对方近况、继续之前的话题、分享你的日常
3. 要自然且不突兀
4. 1-3句话即可
5. 不要提及"系统"、"主动发消息"等元信息

直接开始说话：`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    // 调用AI生成主动消息
    const messageContent = await callAI(userId, messages);

    // 生成消息ID
    const messageId = `msg_proactive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 保存到数据库
    await db.query(
      `INSERT INTO messages (user_id, character_id, message_id, role, content) 
       VALUES (?, ?, ?, 'assistant', ?)`,
      [userId, characterId, messageId, messageContent]
    );

    // 计算下次发送时间（使用随机间隔）
    const nextTime = calculateNextTime(
      character.proactive_interval_min,
      character.proactive_interval_max
    );

    // 更新角色信息
    await db.query(
      'UPDATE characters SET last_proactive_time = NOW(), next_proactive_time = ? WHERE id = ?',
      [nextTime, character.id]
    );

    console.log(`✅ Proactive message sent for character: ${character.name}`);
    console.log(`⏰ Next message scheduled at: ${nextTime.toISOString()}`);

    // 发送推送通知
    try {
      const config = character.config ? JSON.parse(character.config) : {};
      const senderName = config.aiNickname || character.name;
      
      await sendPushNotification(userId, {
        title: senderName,
        body: messageContent.length > 100 ? messageContent.substring(0, 97) + '...' : messageContent,
        icon: '/icon.png',
        badge: '/badge.png',
        tag: `proactive-${characterId}`,
        data: {
          characterId: characterId,
          messageId: messageId,
          type: 'proactive'
        }
      });
      console.log(`📱 Push notification sent for character: ${character.name}`);
    } catch (pushError) {
      console.error('Push notification error:', pushError);
    }
  } catch (error) {
    console.error('Send proactive message error:', error);
    
    // 发生错误时也要设置下次时间，避免一直重试
    const nextTime = new Date(Date.now() + 10 * 60 * 1000); // 10分钟后重试
    await db.query(
      'UPDATE characters SET next_proactive_time = ? WHERE id = ?',
      [nextTime, character.id]
    );
  }
}

module.exports = {
  startProactiveMessaging,
  checkAndSendProactiveMessages,
  sendProactiveMessage
};
