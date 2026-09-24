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

访问 `http://服务器IP:8080`。生产服务使用 Node.js 和 `mysql2` 读取 MySQL，不依赖 Docker；公网部署仍建议使用已有 Nginx 反向代理。

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
├── src/                   # 消费端游戏前端
│   ├── main.js          # 应用入口与依赖组装
│   ├── game.js          # 游戏状态、计分和交互
│   ├── question-history.js # 最近 200 题去重记录
│   ├── questions.js     # 题库数据
│   └── styles.css       # 响应式样式
├── deploy/
│   ├── nginx.conf       # Nginx 静态站点配置
│   └── thumb-guessr.service # systemd 服务配置
├── Dockerfile           # 可选的生产镜像
├── index.html           # 页面结构
├── server.mjs           # 消费端 HTTP 服务：静态页面 + MySQL 查询 API
├── producer/             # 本地数据生产端，不部署到 ECS
│   ├── index.html        # 本地生产端页面
│   ├── server.mjs        # 本地生产端服务
│   ├── sync-youtube.mjs  # 命令行同步入口
│   ├── discover-youtube.mjs # 批量发现中文、非时政视频
│   └── youtube-sync-core.mjs
└── package.json         # 开发、检查、构建和启动命令
```

游戏过程状态只保存在浏览器本地：最高连续答对数和最近 200 个已展示的视频 ID 使用 `localStorage`，用于减少重复题目。消费端通过后端读取 MySQL 中已同步的视频数据。

## 从 YouTube 同步真实视频数据

这是两套明确分开的逻辑：

- 数据生产端：本地 `producer/`，访问 YouTube Data API 并写入 MySQL。
- 数据消费端：ECS 上的 `server.mjs` 和游戏前端，只读取 MySQL，不访问 YouTube。

先将 [`producer/.env.example`](./producer/.env.example) 复制为项目根目录的 `.env.local`（该文件不会提交）：

```dotenv
YOUTUBE_API_KEY=你的本地 YouTube Data API Key
YOUTUBE_PROXY_URL=http://127.0.0.1:7897  # 当前本机代理端口；如果环境不同请按实际端口修改
DB_HOST=124.72.50.154
DB_PORT=8736
DB_NAME=thumb_guessr
DB_USER=root
DB_PASSWORD=你的数据库密码
OSS_ENABLED=true
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=你的 OSS Bucket
OSS_ACCESS_KEY_ID=你的 AccessKey ID
OSS_ACCESS_KEY_SECRET=你的 AccessKey Secret
OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
OSS_PUBLIC_BASE_URL=https://你的 OSS 公网域名
OSS_OBJECT_PREFIX=thumb-guessr/covers
```

上面的数据库地址、端口、库名和用户对应当前开发数据库；`DB_PASSWORD`、`YOUTUBE_API_KEY`、OSS AccessKey 和公网域名仍需由部署者自行填写，且只保存在本地 `.env.local` 或服务器真实配置文件中，不能提交到 Git。

然后传入一个或多个 YouTube 视频链接/ID：

```bash
npm ci
npm run youtube:sync -- \
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ' \
  'https://youtu.be/9bZkp7q19f0'
```

也可以直接传 11 位视频 ID，例如 `npm run youtube:sync -- YWqnPoIE6_w`。不要把 Markdown 展示格式（`[标题](URL)`）当作参数；脚本也会尝试自动识别这种格式。

如果希望用页面生产数据，而不是命令行：

```bash
npm run producer
```

然后打开 `http://127.0.0.1:4174`。这个页面只在本地运行，API Key 也只存在本地进程，不会部署到 ECS。同步成功后，ECS 消费端就可以读取这些数据。

封面写入流程是：本地从 YouTube 下载封面 → 上传到 OSS → `videos.thumbnail_url` 保存 OSS 公网地址。AccessKey 只放在本地 `.env.local`，不要配置到 ECS。为了让浏览器 CSP 放行 OSS 图片，需要在 ECS 的 `/app/thumb-guessr/.env` 增加同一个 `OSS_PUBLIC_BASE_URL`（只填公网域名，不填 AccessKey），然后重启 `thumb-guessr.service`。

### 批量发现中文视频

批量任务会按多个非时政主题搜索 YouTube，要求标题包含中文字符，过滤新闻、政治、战争、外交、军事等关键词，排除数据库中已有记录，并按视频 ID 去重。默认目标是 500 条：

```bash
npm run youtube:discover
```

可以用 `YOUTUBE_DISCOVERY_TARGET` 或 `--target=200` 调整目标数量。搜索结果会分批调用 `videos.list`，每批同步到 OSS 和 MySQL；默认搜索请求上限为 40 次，避免意外消耗过多 YouTube API 配额。

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
