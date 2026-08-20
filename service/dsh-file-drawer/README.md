# 📂 DSH File Panel Drawer（文件管理面板抽屉）

在 DSH 界面顶部导航栏添加「📂 文件」按钮，点击后从右侧滑出文件管理面板，方便快速浏览和管理工作区文件。

> 面板通过 `<iframe>` 嵌入，需要一个独立的文件面板 Web 服务作为后端。本插件本身不包含文件面板服务，你需要自行部署或使用已有的文件管理工具。

---

## ✨ 功能特性

- 📂 **抽屉式面板** — 从右侧滑出，不占用主界面空间
- 🎯 **导航栏按钮** — 在顶部导航栏（对话、轨迹之后）显示「📂 文件」按钮
- ⌨️ **快捷键** — 按 `Escape` 关闭面板
- 🖱️ **点击遮罩关闭** — 点击面板外的区域自动关闭
- 🔄 **平滑动画** — 展开/收起带有流畅的 CSS 过渡效果
- 🔒 **iframe 沙箱隔离** — 不会泄露 DSH 的认证信息

---

## 📦 安装

### 方式一：克隆 + 链接（推荐）

```bash
# 1. 克隆插件库
git clone https://github.com/shynloc/acks-dsh-plugins.git

# 2. 链接到 DSH web profile
ln -sf "$(pwd)/acks-dsh-plugins/service/dsh-file-drawer" \
       "$DSH_HOME/profiles/web/node_modules/dsh-file-drawer"

# 3. 在 $DSH_HOME/profiles/web/package.json 中注册：
#    dependencies:  "dsh-file-drawer": "file:./node_modules/dsh-file-drawer"
#    dsh.profile.bundles:  "dsh-file-drawer"
```

### 方式二：`dsh plugin` 命令

```bash
dsh plugin --profile web add ./acks-dsh-plugins/service/dsh-file-drawer
```

安装后重启 DSH Web 服务使其生效。

---

## 🔧 配置面板地址

编辑 `lib/client.js`，修改 `PANEL_URL` 变量：

```javascript
var PANEL_URL = "http://localhost:8080";  // ← 改为你的文件面板地址
```

支持的地址格式：

| 场景 | 示例 |
|------|------|
| 本地开发 | `http://localhost:8080` |
| 本机其他端口 | `http://127.0.0.1:3001` |
| 内网 IP | `http://192.168.1.100:8080` |
| 反向代理域名 | `https://files.example.com` |
| 子路径 | `https://example.com/file-panel` |

---

## 🌐 部署文件面板服务

你需要一个可通过浏览器访问的文件管理 Web 服务。以下是几种常见方案：

### 方案 A：Python 内置 HTTP 服务器（最简单）

适合快速本地使用，无需额外安装：

```bash
# 在你想暴露的目录下启动
cd /workspace
python3 -m http.server 8080 --bind 0.0.0.0
```

然后将 `PANEL_URL` 设为 `http://localhost:8080`。

> ⚠️ 这只提供基本的文件浏览，没有上传/编辑功能。

### 方案 B：FileBrowser（推荐）

[FileBrowser](https://filebrowser.org/) 是一个功能完整的 Web 文件管理器，支持上传、下载、编辑、预览：

```bash
# Docker 一键启动
docker run -d \
  --name filebrowser \
  -p 8080:80 \
  -v /workspace:/srv \
  --restart unless-stopped \
  filebrowser/filebrowser:latest

# 默认账号：admin / admin
# 首次登录后请修改密码！
```

然后将 `PANEL_URL` 设为 `http://localhost:8080`。

### 方案 C：Caddy 反向代理 + HTTPS（生产环境推荐）

如果你需要通过域名 + HTTPS 访问文件面板：

```bash
# 1. 安装 Caddy
sudo apt install -y caddy   # Debian/Ubuntu

# 2. 编辑 Caddy 配置
sudo tee /etc/caddy/Caddyfile << 'EOF'
files.example.com {
    reverse_proxy localhost:8080
    # 可选：添加基础认证
    basicauth * {
        # 用 `caddy hash-password` 生成密码哈希
        admin $2a$14$YOUR_HASHED_PASSWORD_HERE
    }
}
EOF

# 3. 启动 Caddy（自动申请 Let's Encrypt 证书）
sudo systemctl restart caddy
```

然后将 `PANEL_URL` 设为 `https://files.example.com`。

### 方案 D：Nginx 反向代理

```nginx
server {
    listen 443 ssl;
    server_name files.example.com;

    ssl_certificate     /etc/letsencrypt/live/files.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/files.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（如果面板需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

然后将 `PANEL_URL` 设为 `https://files.example.com`。

---

## 🚀 使用方法

1. 安装插件并配置好 `PANEL_URL`
2. 确保文件面板服务正在运行
3. 重启 DSH Web 服务
4. 在 DSH 顶部导航栏找到「📂 文件」按钮
5. 点击按钮打开文件面板抽屉
6. 点击 ✕ 或按 Escape 关闭

---

## ⚙️ 高级配置

在 `lib/client.js` 中可以调整以下参数：

```javascript
var PANEL_WIDTH = 420;           // 面板宽度（像素）
var PANEL_URL = "http://...";    // 面板地址
var ANIMATION_DURATION = 300;    // 动画时长（毫秒）
```

---

## 🔒 安全建议

- 生产环境务必使用 HTTPS + 认证
- FileBrowser 等工具首次登录后请立即修改默认密码
- 使用 Caddy/Nginx 反代时可添加 `basicauth` 或 IP 白名单
- iframe 的 `sandbox` 属性已限制为 `allow-same-origin allow-scripts allow-popups allow-forms`

---

## 📝 更新日志

### v0.1.0
- 初始版本
- 导航栏「📂 文件」按钮
- 右侧抽屉式面板
- iframe 沙箱隔离
- 键盘快捷键和点击遮罩关闭

---

## 📄 License

MIT
