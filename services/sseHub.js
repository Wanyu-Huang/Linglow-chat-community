/**
 * SSE 推送中心
 * 
 * 前端通过 GET /api/chat/stream/:characterId 建立长连接。
 * batchWorker 写完 AI 回复后调 sseHub.push() 主动推送。
 * 连接断开时自动清理。
 */

// clients: Map<userId, Map<characterId, Set<res>>>
const clients = new Map();

/**
 * 注册一个 SSE 客户端
 * @param {number} userId
 * @param {string} characterId
 * @param {express.Response} res
 */
function register(userId, characterId, res) {
  if (!clients.has(userId)) clients.set(userId, new Map());
  const userMap = clients.get(userId);
  if (!userMap.has(characterId)) userMap.set(characterId, new Set());
  userMap.get(characterId).add(res);
  console.log(`[SSE] 注册 userId=${userId} characterId=${characterId} 当前连接数=${userMap.get(characterId).size}`);
}

/**
 * 移除一个 SSE 客户端
 */
function unregister(userId, characterId, res) {
  const userMap = clients.get(userId);
  if (!userMap) return;
  const set = userMap.get(characterId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) userMap.delete(characterId);
  if (userMap.size === 0) clients.delete(userId);
  console.log(`[SSE] 移除 userId=${userId} characterId=${characterId}`);
}

/**
 * 向指定用户+角色的所有连接推送消息
 * @param {number} userId
 * @param {string} characterId
 * @param {string} event  - 事件类型，如 'message'
 * @param {object} data   - 要推送的数据
 */
function push(userId, characterId, event, data) {
  const userMap = clients.get(userId);
  if (!userMap) return;
  const set = userMap.get(characterId);
  if (!set || set.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (e) {
      // 连接已断开，清理
      set.delete(res);
    }
  }
}

module.exports = { register, unregister, push };
