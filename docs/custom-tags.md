# 上传标签、多标签搜索与前端自动构建

## 使用方法

上传页新增「上传标签」：可以多选常用项，也可以输入 `旅行 风景` 或 `旅行,风景` 后按回车，一次添加多个标签。点击输入框外部也会确认尚未提交的有效输入。标签可以单独删除或全部清空。不选标签时保持原来的上传行为。

先确认标签，再选择、拖拽或粘贴文件。每个文件在进入上传流程时保存一份标签，后续修改选择不会更改已入队文件的标签；压缩、WebP 转换、失败重试均保留这份标签。普通上传、外链保存、分块合并和 HuggingFace 大文件直传提交都携带标签。

常用项来自本浏览器最近选择的 50 个标签，以及现有的管理员标签自动补全接口。未登录后台时仍能输入标签和选择本机最近使用的标签；登录后台后可以选择已有标签。复用原接口的可见范围：最近 1000 个文件中提取的最多 100 个标签，并非全站使用频率排名。不会开放管理员接口给匿名用户。

沿用原项目标签规则：支持中日韩文字、字母、数字、下划线、连字符；英文字母转小写并去重。标签本身不含空格，空格和中英文逗号用作分隔符。

后台搜索示例：

| 输入 | 含义 |
| --- | --- |
| `#旅行 风景` | 同时包含「旅行」「风景」 |
| `#旅行 #风景` | 同上，兼容原语法 |
| `#旅行,风景` | 同上，逗号分隔 |
| `#旅行 风景 -#截图 水印` | 同时包含旅行、风景，排除带截图或水印的文件 |
| `IMG #旅行 风景` | 文件名含 IMG，并同时包含两个标签 |
| `#旅行 风景 "IMG"` | 同上，用双引号明确文件名关键字 |
| `summer holiday` | 普通文件名搜索 |

`#` 开始包含标签组，`-#` 开始排除标签组，后续空格分隔的词继续加入该组。多个包含标签采用 **AND（同时包含）**，沿用后端原有规则。普通文件名关键字放在标签之前，或用英文双引号包住。

上传 API 的新增可选参数为 `tags`：`/upload?...&tags=travel,photo`（实际请求应 URL 编码）；HuggingFace `commitUpload` 的 JSON 请求体支持 `tags: ["travel", "photo"]`。无需新增数据库字段或迁移，标签与文件元数据一起写入 KV / D1。

## 自动同步：Cloudflare 保持原来的默认配置

工作流已固定好你的仓库、分支和目录，不需要填写这些参数：

```text
OpenAgentAI/Sanyue-ImgHub 的 master 有新提交（包括 Sync fork）
  → Action 自动测试、打包
  → 把 dist 同步到 OpenAgentAI/CloudFlare-ImgBed 的 main / frontend-dist
  → 自动提交并推送
  → 现有 Cloudflare Git 绑定检测到 imgbed 更新，照常部署
```

**Cloudflare 后台不用改，也不需要绑定 imghub、设置构建命令或创建 Deploy Hook。** 之前提到的 Deploy Hook 和 Cloudflare 构建脚本方案已经移除。

### 只需在 GitHub 配置一次凭据

GitHub 自动提供的 `GITHUB_TOKEN` 只能访问工作流所在仓库，不能直接写另一个 fork。因此需要一个能写入后端仓库的 Token，不能把它写死在公开的工作流文件里。

1. 在 GitHub 个人设置的 `Developer settings → Personal access tokens → Fine-grained tokens` 创建 Token。Resource owner 选择 `OpenAgentAI`，仅选择 `CloudFlare-ImgBed` 仓库，Repository permissions 的 **Contents 设为 Read and write**。Metadata 的读取权限由 GitHub 自动附带。
2. 到 **Sanyue-ImgHub** 仓库 → `Settings → Secrets and variables → Actions → New repository secret`，名称填 **`IMGBED_PUSH_TOKEN`**，值填刚创建的 Token。
3. 如果 fork 的 Actions 尚未启用，在 Actions 页面启用它。

先把本次后端标签接口改动提交到 imgbed 的 `main`，再把前端源码和 `.github` 下的新工作流、脚本提交到 imghub 的 `master`。前端提交后会自动执行；也可以在 Actions 中选择 **Build and sync frontend to ImgBed → Run workflow** 手动执行一次。

工作流测试和构建失败时不会同步产物。产物没有变化时不会制造空提交。推送时如果后端有新提交，会取最新 `main` 后重新同步，只提交 `frontend-dist`，不强制推送；原有 `_headers`、`_redirects`、`_routes.json` 在前端未提供同名文件时会保留。

Token 到期后替换同名 Secret 即可。如果 `main` 存在禁止直接推送的分支规则，Action 会报错，需要由仓库管理员允许该凭据推送；工作流不会绕过保护。Action 成功表示产物已经推送，最终上线状态查看原 Cloudflare 项目的部署记录。

说明来源：[GitHub 跨仓库 checkout 与 Token](https://github.com/actions/checkout#checkout-multiple-repos-private)、[Cloudflare Git 集成](https://developers.cloudflare.com/pages/configuration/git-integration/)。

## 与上游同步

源码仍只修改必要的上传、搜索接入位置，新增组件、脚本和工作流独立存放。没有修改依赖或数据库结构。

采用自动推送打包产物后，`frontend-dist` 会产生自己的提交；如果上游也改了这里，`Sync fork` 仍可能冲突，不能保证零冲突。解决产物冲突后，可以重跑 imghub 的同步 Action，重新生成自己的页面。不要使用 `Discard commits` 丢弃定制功能。

升级较大版本时，先更新相容的后端，再更新前端。两边可分别运行 `npm ci`、`npm test`；前端运行 `npm run build` 检查构建。`.github/scripts/sync-imgbed.sh` 只供 Action 的临时后端检出使用，不要直接指向正在开发的工作目录。
