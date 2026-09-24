# thumb-guessr

移动端优先的视频封面播放量竞猜游戏。打开网页即可答题，无需登录；答题后立即显示真实播放量、积分和连续答对记录。

## 快速开始

需要 Node.js 20.19+ 和 npm 10+。

```bash
git clone git@github.com:zhangluease/thumb-guessr.git
cd thumb-guessr
npm ci
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`。

## 在服务器直接部署

```bash
git clone git@github.com:zhangluease/thumb-guessr.git
cd thumb-guessr
npm ci
npm run check
npm run build
PORT=8080 npm start
```

访问 `http://服务器IP:8080`。`server.mjs` 只使用 Node.js 内置模块，生产运行不依赖 Docker、Nginx 或第三方服务。

长期运行建议使用仓库自带的 systemd 服务：

```bash
sudo install -d -o www-data -g www-data /opt/thumb-guessr
sudo cp -R dist server.mjs /opt/thumb-guessr/
sudo useradd --system --home-dir /opt/thumb-guessr --shell /usr/sbin/nologin thumb-guessr
sudo chown -R thumb-guessr:thumb-guessr /opt/thumb-guessr
sudo cp deploy/thumb-guessr.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now thumb-guessr
sudo systemctl status thumb-guessr
```

仓库中的 systemd 服务默认监听 `127.0.0.1:4173`，适合由已有的 Nginx、Caddy 或云平台反向代理到公网；直接执行 `PORT=8080 npm start` 时则监听 8080。

如果使用本项目约定的 ECS 目录 `/app/thumb-guessr`，仓库中的 systemd 单元已经使用该目录和 `/usr/local/bin/node`；其他服务器按实际 Node 路径修改 `deploy/thumb-guessr.service` 即可。

## 构建生产版本

```bash
npm ci
npm run check
npm run build
```

构建结果位于 `dist/`。它是纯静态站点，也可以部署到 Nginx、Caddy、Cloudflare Pages、Vercel、Netlify 或任意静态文件服务器。

本地检查生产构建：

```bash
npm run preview
```

## 使用 Docker 部署（可选）

仓库包含多阶段构建的 `Dockerfile`，最终镜像只包含 Nginx 和静态文件。

```bash
docker build -t thumb-guessr .
docker run -d \
  --name thumb-guessr \
  --restart unless-stopped \
  -p 8080:80 \
  thumb-guessr
```

访问 `http://服务器IP:8080`。如果服务器已配置反向代理，可将域名转发到 `127.0.0.1:8080`。

## 直接部署到 Nginx

先执行 `npm run build`，再把 `dist/` 内容复制到站点目录：

```bash
sudo mkdir -p /var/www/thumb-guessr
sudo cp -R dist/. /var/www/thumb-guessr/
```

仓库中的 [`deploy/nginx.conf`](./deploy/nginx.conf) 可以作为站点配置参考。修改 `root` 后加载到服务器的 Nginx 配置目录并重载服务即可。

## 项目结构

```text
thumb-guessr/
├── public/assets/       # 原创封面图和 favicon
├── src/
│   ├── main.js          # 应用入口与依赖组装
│   ├── game.js          # 游戏状态、计分和交互
│   ├── questions.js     # 题库数据
│   └── styles.css       # 响应式样式
├── deploy/
│   ├── nginx.conf       # Nginx 静态站点配置
│   └── thumb-guessr.service # systemd 服务配置
├── Dockerfile           # 可选的生产镜像
├── index.html           # 页面结构
├── server.mjs           # 零依赖生产服务器
└── package.json         # 开发、检查、构建和启动命令
```

页面状态只保存在浏览器本地：最高连续答对数使用 `localStorage`，没有后端和数据库依赖。

## 修改题库

编辑 [`src/questions.js`](./src/questions.js)。每道题包含：

| 字段 | 作用 |
| --- | --- |
| `title` | 答案揭晓后显示的视频标题 |
| `views` | 原始播放量数值，便于后续接入真实数据 |
| `label` | 正确答案的展示文字 |
| `imagePosition` | 封面雪碧图中的位置 |
| `choices` | 三个竞猜选项，其中一个必须与 `label` 相同 |

修改后运行以下命令确认代码和构建都正常：

```bash
npm run check
npm run build
```

## 常见问题

### 页面刷新后出现 404

静态服务器需要把未匹配路径回退到 `index.html`。仓库自带的 Nginx 配置已经包含该规则。

### 图片没有更新

重新执行 `npm run build` 并部署新的 `dist/`。仓库自带的 Node 和 Nginx 配置对静态资源只缓存一小时，必要时也可以在浏览器中强制刷新。
