const cron = require('node-cron');
const db = require('../config/database');
const { callAI } = require('./ai');
const { sendPushNotification } = require('./push');

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

async function checkAndSendProactiveMessages() {
  try {
    const [characters] = await db.query(
      `SELECT c.id, c.user_id, c.character_id, c.name, c.ai_nickname, c.system_prompt,
              c.proactive_interval, c.last_proactive_time
       FROM characters c
       WHERE c.proactive_enabled = 1
       AND (
         c.last_proactive_time IS NULL 
         OR TIMESTAMPDIFF(SECOND, c.last_proactive_time, NOW()) >= c.proactive_interval
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

async function sendProactiveMessage(character) {
  try {
    const userId = character.user_id;
    const characterId = character.character_id;

    console.log(`📤 Sending proactive message for character: ${character.name} (user: ${userId})`);

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

    const systemPrompt = (character.system_prompt || '你是一个友好的AI助手。') + 
      '\n\n现在请你主动发起一条消息。这条消息应该符合你的角色设定和性格，可以是问候、分享想法、询问对方近况等。自然且不突兀，1-3句话即可。';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history
    ];

    const message = await callAI(userId, messages);

    const messageId = `msg_proactive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await db.query(
      `INSERT INTO messages (user_id, character_id, message_id, role, content, status) 
       VALUES (?, ?, ?, 'assistant', ?, 2)`,
      [userId, characterId, messageId, message]
    );

    await db.query(
      'UPDATE characters SET last_proactive_time = NOW() WHERE id = ?',
      [character.id]
    );

    console.log(`✅ Proactive message sent for character: ${character.name}`);

    try {
      const senderName = character.ai_nickname || character.name;
      await sendPushNotification(userId, {
        title: senderName,
        body: message.length > 100 ? message.substring(0, 97) + '...' : message,
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
    throw error;
  }
}

module.exports = {
  startProactiveMessaging,
  checkAndSendProactiveMessages,
  sendProactiveMessage
};
