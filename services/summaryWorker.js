const db = require('../config/database');
const { callAI } = require('./ai');

// 正在运行的任务（按userId防并发）
const runningUsers = new Set();

/**
 * 启动 summary worker，每10秒轮询一次
 */
function startSummaryWorker() {
  setInterval(async () => {
    try {
      await processPendingTasks();
    } catch (e) {
      console.error('[SummaryWorker] 轮询出错:', e.message);
    }
  }, 10000);
  console.log('✅ Summary worker started');
}

/**
 * 查找待处理任务并执行
 */
async function processPendingTasks() {
  // 找所有 pending 状态、且用户不在运行中的任务
  const [tasks] = await db.query(
    `SELECT * FROM summary_tasks 
     WHERE status = 'pending' 
     ORDER BY created_at ASC 
     LIMIT 10`
  );

  for (const task of tasks) {
    if (runningUsers.has(task.user_id)) continue;
    // 异步跑，不等待，实现不同用户并发
    runTask(task).catch(e => console.error('[SummaryWorker] runTask异常:', e.message));
  }
}

/**
 * 执行单个任务
 */
async function runTask(task) {
  const { id: taskId, user_id: userId, character_id: characterId } = task;

  runningUsers.add(userId);
  console.log(`[SummaryWorker] 开始任务 ${taskId}，用户 ${userId}，角色 ${characterId}`);

  try {
    await db.query(
      "UPDATE summary_tasks SET status = 'running', updated_at = NOW() WHERE id = ?",
      [taskId]
    );

    // 加载角色信息（system_prompt、long_term_memory）
    const [chars] = await db.query(
      'SELECT * FROM characters WHERE user_id = ? AND character_id = ?',
      [userId, characterId]
    );
    if (chars.length === 0) throw new Error('角色不存在');
    const character = chars[0];

    const { safeJsonParse, safeStringify } = require('./jsonHelper');
    let longTermMemory = safeJsonParse(character.long_term_memory, null) || {
      basic_info: {},
      emotional_profile: '',
      relationships: '',
      important_events: [],
      metadata: { total_messages: 0, last_summary_at: 0, last_updated: null, version: 2, next_memory_id: 1 }
    };

    // 从任务里取本次要总结的消息范围
    const taskData = safeJsonParse(task.task_data, {});
    const { messageIds } = taskData; // 导入时记录的所有要总结的消息ID数组

    // 从数据库加载这批消息，按seq正序
    const [allMessages] = await db.query(
      `SELECT message_id as id, role, content, timestamp FROM messages
       WHERE user_id = ? AND character_id = ? AND message_id IN (?)
       ORDER BY seq ASC, id ASC`,
      [userId, characterId, messageIds]
    );

    const intervalSize = task.interval_size || 200;
    const totalBatches = task.total_batches;
    let currentBatch = task.current_batch;

    // 从 current_batch 开始续跑（支持重试）
    while (currentBatch < totalBatches) {
      // 检查任务是否被用户暂停或取消
      const [fresh] = await db.query('SELECT status FROM summary_tasks WHERE id = ?', [taskId]);
      if (!fresh.length || fresh[0].status === 'cancelled') {
        console.log(`[SummaryWorker] 任务 ${taskId} 已取消`);
        return;
      }
      if (fresh[0].status === 'paused') {
        console.log(`[SummaryWorker] 任务 ${taskId} 已暂停，等待用户操作`);
        return;
      }

      const start = currentBatch * intervalSize;
      const end = Math.min(start + intervalSize, allMessages.length);
      const batch = allMessages.slice(start, end);

      if (batch.length === 0) break;

      console.log(`[SummaryWorker] 任务 ${taskId}：第 ${currentBatch + 1}/${totalBatches} 批，${batch.length} 条消息`);

      try {
        longTermMemory = await summarizeBatch(batch, longTermMemory, character);
      } catch (err) {
        console.error(`[SummaryWorker] 任务 ${taskId} 第 ${currentBatch + 1} 批失败:`, err.message);
        // 保存当前longTermMemory和进度，暂停任务
        await db.query(
          `UPDATE summary_tasks 
           SET status = 'paused', current_batch = ?, error_message = ?, updated_at = NOW()
           WHERE id = ?`,
          [currentBatch, err.message, taskId]
        );
        // 保存已完成的长期记忆
        await db.query(
          'UPDATE characters SET long_term_memory = ? WHERE user_id = ? AND character_id = ?',
          [safeStringify(longTermMemory, null), userId, characterId]
        );
        return;
      }

      currentBatch++;

      // 每批完成后更新进度 + 保存长期记忆
      await db.query(
        `UPDATE summary_tasks SET current_batch = ?, updated_at = NOW() WHERE id = ?`,
        [currentBatch, taskId]
      );
      await db.query(
        'UPDATE characters SET long_term_memory = ? WHERE user_id = ? AND character_id = ?',
        [safeStringify(longTermMemory, null), userId, characterId]
      );
    }

    // 全部完成
    await db.query(
      "UPDATE summary_tasks SET status = 'done', current_batch = ?, updated_at = NOW() WHERE id = ?",
      [totalBatches, taskId]
    );
    console.log(`[SummaryWorker] 任务 ${taskId} 全部完成`);

  } catch (err) {
    console.error(`[SummaryWorker] 任务 ${taskId} 异常:`, err.message);
    await db.query(
      "UPDATE summary_tasks SET status = 'paused', error_message = ?, updated_at = NOW() WHERE id = ?",
      [err.message, taskId]
    );
  } finally {
    runningUsers.delete(userId);
  }
}

/**
 * 对一批消息调AI生成/更新长期记忆，返回更新后的 longTermMemory
 */
async function summarizeBatch(messages, longTermMemory, character) {
  const { safeJsonParse } = require('./jsonHelper');
  const config = safeJsonParse(character.config, {});
  const systemPrompt = character.system_prompt || '你是一个友好的AI助手。';
  const userNickname = config.userNickname || '用户';
  const aiNickname = config.aiNickname || character.name || 'AI';

  const firstTimestamp = messages[0]?.timestamp;
  const lastTimestamp = messages[messages.length - 1]?.timestamp;
  const timeRange = `${new Date(firstTimestamp).toLocaleString('zh-CN')} 至 ${new Date(lastTimestamp).toLocaleString('zh-CN')}`;

  const conversationText = messages.map(b => {
    const time = new Date(b.timestamp).toLocaleString('zh-CN');
    const speaker = b.role === 'user' ? userNickname : aiNickname;
    return `[${time}] ${speaker}: ${b.content}`;
  }).join('\n\n');

  const existingMemoriesContext = (longTermMemory.important_events || []).map(m =>
    `[${m.memory_id}] ${m.title} (${m.type})\n   重要度: ${m.importance}分\n   提及: ${m.mention_count}次\n   内容: ${(m.content || '').substring(0, 100)}`
  ).join('\n\n');

  const summaryPrompt = `【角色设定】
${systemPrompt}

你正在整理你和用户的聊天记忆。以第一人称（"我"）的视角，记录你眼中发生的事情和你的感受。

【对话时间范围】
${timeRange}
气泡数量：${messages.length}个

【当前已有的基本信息】
${Object.keys(longTermMemory.basic_info || {}).length > 0 ? JSON.stringify(longTermMemory.basic_info, null, 2) : '无'}

【当前已有的性格偏好】
${longTermMemory.emotional_profile || '无'}

【当前已有的重要事件】
${existingMemoriesContext || '无'}

【新对话记录】
${conversationText}

【任务要求】
每次生成必须完成三个判断：

1. 基本信息更新判断（兴趣爱好）
   - 是否发现用户新的兴趣爱好？格式：名词或动词短语
   - 如果有，输出需要添加的兴趣；如果无，输出null

2. 性格偏好更新判断（延伸追加，不覆盖）
   - 是否发现用户新的性格特点、行为模式、价值观？
   - 以第一人称视角描述："我注意到TA..."
   - 如果有新发现，输出要追加的内容（50-100字）；如果无，输出null

3. 重要事件处理（只生成0或1条）
   - 优先判断：是否在延续/更新已有记忆？→ action: "update"
   - 其次判断：是否有值得记录的新话题？→ action: "create"
   - 最后：日常寒暄、无关紧要 → action: "skip"

【输出格式】（纯JSON，无markdown代码块）
{
  "basic_info_updates": {"足球": "喜欢踢足球"} 或 null,
  "emotional_profile_update": "我发现TA..." 或 null,
  "memory_action": {
    "action": "update" 或 "create" 或 "skip",
    "memory_id": "mem_001",
    "new_content": "新增内容（带日期）",
    "心路历程": "我的感受",
    "new_importance": 数字,
    "title": "3-6字主题",
    "type": "personal" 或 "relationship",
    "content": "完整内容（带日期）",
    "importance": 数字,
    "reason": "跳过原因"
  }
}`;

  const aiMessages = [
    {
      role: 'system',
      content: `${systemPrompt}\n\n现在你需要整理你和用户的聊天记忆。请以角色的第一人称视角，客观、温和地记录发生的事情和你的感受。严格按照要求输出纯JSON格式。`
    },
    { role: 'user', content: summaryPrompt }
  ];

  const rawResponse = await callAI(character.user_id, aiMessages, null, character.character_id);
  const cleaned = rawResponse.replace(/^```json\n?/i, '').replace(/\n?```$/i, '').trim();
  const result = JSON.parse(cleaned);

  // 1. 更新基本信息
  if (result.basic_info_updates) {
    for (const [key, value] of Object.entries(result.basic_info_updates)) {
      longTermMemory.basic_info[key] = value;
    }
  }

  // 2. 追加性格偏好
  if (result.emotional_profile_update) {
    longTermMemory.emotional_profile = longTermMemory.emotional_profile
      ? longTermMemory.emotional_profile + ' ' + result.emotional_profile_update
      : result.emotional_profile_update;
  }

  // 3. 处理重要事件
  const memoryAction = result.memory_action;
  if (!longTermMemory.metadata) {
    longTermMemory.metadata = { total_messages: 0, last_summary_at: 0, last_updated: null, version: 2, next_memory_id: 1 };
  }

  if (memoryAction.action === 'update') {
    const memory = (longTermMemory.important_events || []).find(m => m.memory_id === memoryAction.memory_id);
    if (memory) {
      memory.content += ' ' + memoryAction.new_content;
      memory.last_mentioned = lastTimestamp;
      memory.mention_count = (memory.mention_count || 0) + 1;
      memory.心路历程 = memoryAction.心路历程;
      memory.importance = memoryAction.new_importance;
    }
  } else if (memoryAction.action === 'create') {
    const newMemory = {
      memory_id: 'mem_' + String(longTermMemory.metadata.next_memory_id).padStart(3, '0'),
      type: memoryAction.type,
      title: memoryAction.title,
      created_at: firstTimestamp,
      last_mentioned: lastTimestamp,
      mention_count: 1,
      content: memoryAction.content,
      心路历程: memoryAction.心路历程,
      importance: memoryAction.importance
    };
    if (!longTermMemory.important_events) longTermMemory.important_events = [];
    longTermMemory.important_events.push(newMemory);
    longTermMemory.metadata.next_memory_id++;
  }

  // 按重要度排序，保留最多30条（后台批量不做截断，保留更多）
  longTermMemory.important_events.sort((a, b) => b.importance - a.importance);
  if (longTermMemory.important_events.length > 30) {
    longTermMemory.important_events = longTermMemory.important_events.slice(0, 30);
  }

  // 更新元数据
  longTermMemory.metadata.last_updated = new Date().toISOString();

  return longTermMemory;
}

module.exports = { startSummaryWorker };
