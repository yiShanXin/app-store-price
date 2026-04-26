# app-store-price (Cloudflare Workers 版本)

## 为了方便部署 原项目请求场景会触发网络拦截  https://github.com/hypooo/app-store-price

这个版本把原项目迁移到 Cloudflare：

- `public/`：前端静态页面（原样搬运）
- `src/worker.ts`：`/app/*` API（搜索、详情、比价、热门词、汇率转换）
- `KV`：搜索结果缓存、详情缓存、热门词、汇率缓存
- `Cron`：每天刷新一次汇率

## 1. 初始化 Cloudflare（自动创建 KV 并回填 ID）

```bash
npx wrangler login
npm run setup:kv
```

`npm run setup:kv` 会自动：

- 创建（或复用）`APP_CACHE`、`FX_CACHE` 及对应 preview namespace
- 把 ID 写回 `wrangler.toml` 的 `id` / `preview_id`

## 2. 本地开发

```bash
npm install
npm run dev
```

## 3. 手动部署

```bash
npm run deploy
```

## 4. GitHub 自动部署

仓库已内置 `.github/workflows/deploy.yml`，会在 `main` 分支 push 时自动发布到 Cloudflare。

在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 里添加：

- `CLOUDFLARE_API_TOKEN`（需要 Workers + KV 编辑权限）
- `CLOUDFLARE_ACCOUNT_ID`

部署后同域可直接使用原前端，接口路径保持不变：

- `POST /app/getAreaList`
- `POST /app/getPopularSearchWordList`
- `POST /app/getAppList`
- `POST /app/getAppInfo`
- `POST /app/getAppInfoComparison`
