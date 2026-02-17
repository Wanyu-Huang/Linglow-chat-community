/**
 * 角色信息页模态框
 */

let currentCardData = null;

// 显示信息页模态框
function showCharacterInfoModal(cardData) {
    currentCardData = cardData;
    
    const modal = document.getElementById('character-info-modal');
    const content = modal.querySelector('.character-info-content');
    
    // 构建HTML
    content.innerHTML = `
        <!-- 头像区域 -->
        <div class="character-info-avatar-section">
            ${cardData.avatar ? 
                `<img src="${cardData.avatar}" class="character-info-avatar" alt="${escapeHtml(cardData.name)}">` :
                `<div class="character-info-default-avatar">${escapeHtml(cardData.name.substring(0, 1))}</div>`
            }
            <div class="character-info-name">${escapeHtml(cardData.name)}</div>
            <div class="character-info-id">角色ID：${generateShortId(cardData.name)}</div>
        </div>

        <!-- 信息区域 -->
        <div class="character-info-details">
            <div class="character-info-row">
                <div class="character-info-label">个性签名</div>
                <div class="character-info-value">${escapeHtml(cardData.signature)}</div>
            </div>
        </div>

        <!-- 按钮 -->
        <div class="character-info-actions">
            <button class="btn-primary" onclick="onAddFriendClick()">添加好友</button>
        </div>
    `;
    
    // 显示模态框
    modal.style.display = 'flex';
    
    // 点击背景关闭
    modal.onclick = function(e) {
        if (e.target === modal) {
            closeCharacterInfoModal();
        }
    };
}

// 关闭信息页模态框
function closeCharacterInfoModal() {
    const modal = document.getElementById('character-info-modal');
    modal.style.display = 'none';
    currentCardData = null;
}

// 点击添加好友
function onAddFriendClick() {
    if (!currentCardData) return;
    
    closeCharacterInfoModal();
    showAddFriendModal(currentCardData);
}

// 生成短ID
function generateShortId(name) {
    const hash = name.split('').reduce((acc, char) => {
        return char.charCodeAt(0) + ((acc << 5) - acc);
    }, 0);
    return 'char_' + Math.abs(hash).toString(36).substring(0, 8);
}

// HTML转义
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
