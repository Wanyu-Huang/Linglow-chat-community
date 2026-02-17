/**
 * 角色卡导入工具
 * 支持SillyTavern格式的PNG和JSON
 * VERSION: 2.0 - 2026-01-19
 */

console.log('✅ character-import.js loaded - VERSION 2.0');

/**
 * 解析角色卡文件
 * @param {File} file - 上传的文件
 * @returns {Promise<Object>} 解析后的角色数据
 */
async function parseCharacterCard(file) {
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.json')) {
        return await parseJSONCard(file);
    } else if (fileName.endsWith('.png')) {
        return await parsePNGCard(file);
    } else {
        throw new Error('不支持的文件格式，请上传 .json 或 .png 文件');
    }
}

/**
 * 解析JSON格式角色卡
 */
async function parseJSONCard(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    
    return normalizeCardData(data);
}

/**
 * 解析PNG格式角色卡（SillyTavern标准）
 */
async function parsePNGCard(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const arrayBuffer = e.target.result;
                const uint8Array = new Uint8Array(arrayBuffer);
                
                // 查找tEXt chunk
                const textChunk = findPNGTextChunk(uint8Array);
                if (!textChunk) {
                    reject(new Error('PNG文件中未找到角色卡数据'));
                    return;
                }
                
                // 解析JSON数据
                const jsonStr = textChunk;
                const data = JSON.parse(jsonStr);
                
                // 读取图片作为头像
                const base64 = arrayBufferToBase64(arrayBuffer);
                data.avatar = `data:image/png;base64,${base64}`;
                
                resolve(normalizeCardData(data));
            } catch (err) {
                reject(new Error('解析PNG角色卡失败: ' + err.message));
            }
        };
        
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 查找PNG的tEXt chunk
 */
function findPNGTextChunk(uint8Array) {
    // PNG文件结构：8字节签名 + chunks
    let offset = 8;
    
    while (offset < uint8Array.length) {
        // 读取chunk长度（4字节，大端）
        const length = (uint8Array[offset] << 24) | 
                      (uint8Array[offset + 1] << 16) | 
                      (uint8Array[offset + 2] << 8) | 
                      uint8Array[offset + 3];
        offset += 4;
        
        // 读取chunk类型（4字节）
        const type = String.fromCharCode(
            uint8Array[offset],
            uint8Array[offset + 1],
            uint8Array[offset + 2],
            uint8Array[offset + 3]
        );
        offset += 4;
        
        // 如果是tEXt chunk
        if (type === 'tEXt') {
            // 查找关键字 "chara"
            let keywordEnd = offset;
            while (keywordEnd < offset + length && uint8Array[keywordEnd] !== 0) {
                keywordEnd++;
            }
            
            const keyword = String.fromCharCode(...uint8Array.slice(offset, keywordEnd));
            
            if (keyword === 'chara') {
                // 读取数据（关键字后的null终止符之后）
                const dataStart = keywordEnd + 1;
                const dataEnd = offset + length;
                const textData = uint8Array.slice(dataStart, dataEnd);
                
                // 转换为字符串
                const decoder = new TextDecoder('utf-8');
                const text = decoder.decode(textData);
                
                // Base64解码
                try {
                    return atob(text);
                } catch (e) {
                    return text; // 如果不是base64，直接返回
                }
            }
        }
        
        // 跳到下一个chunk（数据 + 4字节CRC）
        offset += length + 4;
    }
    
    return null;
}

/**
 * ArrayBuffer转Base64
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * 标准化角色卡数据
 */
function normalizeCardData(data) {
    // 提取必要字段
    const normalized = {
        name: data.name || data.char_name || '未命名角色',
        description: data.description || data.char_persona || '',
        personality: data.personality || '',
        scenario: data.scenario || data.world_scenario || '',
        firstMessage: data.first_mes || data.mes_example || '',
        avatar: data.avatar || null,
        tags: data.tags || [],
        creator: data.creator || '',
        characterVersion: data.character_version || ''
    };
    
    // 构建system_prompt
    normalized.systemPrompt = buildSystemPrompt(normalized);
    
    // 构建个性签名（用于显示）
    normalized.signature = buildSignature(normalized);
    
    return normalized;
}

/**
 * 构建系统提示词
 */
function buildSystemPrompt(card) {
    let prompt = '';
    
    if (card.description) {
        prompt += card.description;
    }
    
    if (card.personality) {
        if (prompt) prompt += '\n\n';
        prompt += `性格：${card.personality}`;
    }
    
    if (card.scenario) {
        if (prompt) prompt += '\n\n';
        prompt += `场景：${card.scenario}`;
    }
    
    return prompt.trim() || '你是一个友好的AI助手。';
}

/**
 * 构建个性签名（用于信息页显示）
 */
function buildSignature(card) {
    // 优先使用personality，其次description的前50字
    if (card.personality) {
        return card.personality.substring(0, 50) + (card.personality.length > 50 ? '...' : '');
    }
    
    if (card.description) {
        return card.description.substring(0, 50) + (card.description.length > 50 ? '...' : '');
    }
    
    return '这个人很神秘，什么也没留下。';
}

/**
 * 验证角色卡数据
 */
function validateCardData(data) {
    if (!data.name) {
        throw new Error('角色卡缺少名称字段');
    }
    
    if (!data.systemPrompt) {
        throw new Error('无法生成角色设定');
    }
    
    return true;
}
