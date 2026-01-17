# 🎨 Linglow Chat - 开源AI聊天应用

> 为创作者打造 · 开箱即用 · 完全免费 · MIT协议

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Wanyu-Huang/Linglow-chat-community.svg)](https://github.com/Wanyu-Huang/Linglow-chat-community/stargazers)
[![Docker](https://img.shields.io/badge/docker-ready-green.svg)](docker-compose.yml)

[🚀 在线演示](https://demo.Linglow-chat.com) | 
[📖 文档](docs/) | 
[💬 讨论区](https://github.com/Wanyu-Huang/Linglow-chat-community/discussions) |
[🐛 报告问题](https://github.com/Wanyu-Huang/Linglow-chat-community/issues)

---

## ✨ 特性

### 🎯 为什么选择 Linglow Chat？

- 🚀 **5分钟部署** - Docker一键启动
- 🎨 **精美界面** - 专业设计，开箱即用
- 🤖 **多角色管理** - 创建多个AI人格
- 💬 **实时对话** - 流畅的聊天体验
- 📱 **主动消息** - AI可以主动发起对话
- 🔔 **推送通知** - 浏览器原生通知
- ⭐ **消息收藏** - 保存重要对话
- 🔧 **灵活配置** - 支持多种AI接口
- 🆓 **完全免费** - MIT协议，商用随意

### 🔌 API支持

- ✅ OpenAI格式（ChatGPT、GPT-4等）
- ✅ Claude格式（Anthropic官方）
- ✅ 中转站（大部分国内服务商）
- ✅ 自定义API接口

---

## 🚀 快速开始

### 前置要求

- Docker & Docker Compose
- AI API Key（OpenAI、Claude或中转站）

### 3步部署

#### 1️⃣ 克隆项目

```bash
git clone https://github.com/Wanyu-Huang/Linglow-chat-community.git
cd Linglow-chat-community
```

#### 2️⃣ 配置环境

```bash
# 复制配置文件
cp .env.universal.example .env

# 编辑配置（用记事本或文本编辑器打开）
notepad .env  # Windows
nano .env     # Linux/Mac
```

**最小配置：**
```env
# 数据库密码（随便设置一个）
DB_PASSWORD=YourStrongPassword123

# Session密钥（随便打一串字符）
SESSION_SECRET=your-random-secret-key-here

# 你的AI API配置（二选一）
# 选项1：OpenAI格式（推荐 - 兼容大部分中转站）
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://api.openai.com

# 选项2：Claude格式（Anthropic官方）
# ANTHROPIC_API_KEY=sk-ant-api03-your-key
# ANTHROPIC_BASE_URL=https://api.anthropic.com
```

#### 3️⃣ 启动服务

```bash
docker-compose up -d

# 访问应用
open http://localhost:8816
```

**就这么简单！🎉**

---

## 📖 文档

### 新手指南
- [🔰 零基础部署教程](docs/BEGINNER_GUIDE.md)
- [📸 图文教程](docs/STEP_BY_STEP.md)
- [✅ 部署检查清单](docs/CHECKLIST.md)
- [🆘 故障排除](docs/TROUBLESHOOTING.md)

### 进阶文档
- [🔌 API格式说明](API_FORMAT_GUIDE.md)
- [🎨 前端集成](docs/FRONTEND_INTEGRATION.md)
- [🤝 贡献指南](CONTRIBUTING.md)

---

## 🎓 适合谁使用？

### ✅ 完美适合

- 📝 **内容创作者** - 给粉丝提供AI互动
- 🎬 **UP主/博主** - 创建专属AI角色
- 💻 **开发者** - 学习全栈开发
- 🏫 **学生** - 课程项目
- 🏢 **小团队** - 内部AI助手

### 💡 使用场景

- 个人AI助手
- 粉丝互动工具
- 客服机器人
- 知识问答
- 创意写作
- 语言学习

---

## 🛠️ 技术栈

```
前端：HTML5 + CSS3 + JavaScript
后端：Node.js + Express
数据库：MySQL 8.0
AI：OpenAI / Claude / 自定义
部署：Docker + Docker Compose
```

---

## 🤝 贡献

欢迎贡献！我们需要：

- 🐛 报告Bug
- 💡 提出新功能
- 📝 改进文档
- 🌍 翻译项目
- 💻 提交代码

查看 [贡献指南](CONTRIBUTING.md) 了解更多。

### 贡献者

感谢所有贡献者！

<a href="https://github.com/Wanyu-Huang/Linglow-chat-community/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Wanyu-Huang/Linglow-chat-community" />
</a>

---

## 🗺️ 路线图

### ✅ v1.0（当前版本）
- ✅ 基础聊天功能
- ✅ 多角色管理
- ✅ Docker部署
- ✅ 用户认证
- ✅ 支持OpenAI
- ✅ 记忆优化

### 🚧 v1.1（计划中）
- 🔄 主题自定义
- 🎤 语音消息
- 🖼️ 图片识别
- 📱 移动端优化
- 📱 群聊消息
- 📱 全天候真实主动问候
- 📱 联网查询
- 📱 记忆库优化

### 📋 v2.0（未来）
- 🔌 RAG记忆库
- 👥 用户社交
- 📊 数据分析
- 💾 番茄种应用

查看 [完整路线图](https://github.com/Wanyu-Huang/Linglow-chat-community/projects)

---

## 🌟 Star历史

[![Star History Chart](https://api.star-history.com/svg?repos=Wanyu-Huang/Linglow-chat-community&type=Date)](https://star-history.com/#Wanyu-Huang/Linglow-chat-community&Date)

---

## 💬 社区

### 加入讨论
- [GitHub Discussions](https://github.com/你Wanyu-Huang/Linglow-chat-community/discussions)
- [Discord]
- [微信群]

### 关注更新
- [Twitter]
- [小红书]

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源。

**这意味着：**
- ✅ 可以自由使用
- ✅ 可以修改代码
- ✅ 可以商业使用
- ✅ 可以私有部署
- ⚠️ 保留版权声明即可

---

## 💖 支持项目

如果这个项目对你有帮助：

### ⭐ 给个Star
最简单也最有用的支持！

### 📣 分享推荐
- 在社交媒体分享
- 写博客文章介绍
- 推荐给朋友

### 🛠️ 贡献代码
- 提交PR改进项目
- 报告和修复Bug
- 改进文档

### ☕ 赞助
- [爱发电](https://afdian.net/@你的ID)
- [Buy me a coffee](https://buymeacoffee.com/你的ID)

---

## 🙏 致谢

本项目使用了以下开源项目：

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [MySQL](https://www.mysql.com/)
- [Docker](https://www.docker.com/)

感谢所有贡献者和用户！❤️

---

## 📞 联系方式

- 📧 Email: your-email@example.com
- 🐛 Issues: [GitHub Issues](https://github.com/Wanyu-Huang/Linglow-chat-community/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/Wanyu-Huang/Linglow-chat-community/discussions)

---

## 📊 项目状态

![GitHub last commit](https://img.shields.io/github/last-commit/Wanyu-Huang/Linglow-chat-community)
![GitHub issues](https://img.shields.io/github/issues/Wanyu-Huang/Linglow-chat-community)
![GitHub pull requests](https://img.shields.io/github/issues-pr/Wanyu-Huang/Linglow-chat-community)

---

<div align="center">

### Made with ❤️ by [你的名字]

**如果喜欢，请给个Star ⭐️**

[GitHub](https://github.com/Wanyu-Huang) · 
</div>
