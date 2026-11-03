# 源码发布指南

## 本地数据不等于源码

请保留本机运行数据，但不要上传它。只有 `scripts/release-manifest.json` 中列出的文件进入发布包。

默认排除：`data/`、`browser-profiles/`、`research/`、`artifacts/`、`node_modules/`、`dist/`、日志、数据库、环境文件、密钥、截图和导出的私人收藏。

**不要使用文件管理器的“压缩整个项目文件夹”。** `.gitignore` 不会帮这种 ZIP 过滤文件。使用下述命令生成的 `dist/video-vault-source.zip`，或者上传按白名单暂存的 Git 内容。

## 发布前流程

在源码目录执行：

```bash
npm ci
npm run check
npm test
npm run test:ui
npm run release:check
```

浏览器测试需要本机安装 Chrome，或通过 `VAULT_BROWSER` 指定可用通道。它使用临时数据库及模拟响应，不应使用个人平台会话。

如果项目还没有独立 Git 仓库：

```bash
git init -b main
```

然后只暂存发布白名单：

```bash
npm run release:stage
git diff --cached --stat
npm run release:check
npm run release:pack
```

输出为 `dist/video-vault-source.zip`，包内只有 `video-vault/` 源码目录。打包使用 Git 暂存树，不依赖已有提交，**不会自动 commit 或 push**。

若白名单文件有未暂存修改，打包会失败。检查修改后重新运行 `release:stage`。若索引中存在白名单外文件，脚本会停止，不会擅自删除你的其他暂存内容；请检查原因后处理。

## 待真正上传 GitHub 时再决定

- 使用哪个 GitHub 账号、仓库名、公开或私有。
- 首次提交的 Git 作者姓名和邮箱；这些会进入提交历史。需要隐藏邮箱时，可先在 GitHub 设置中获取自己的官方 noreply 地址，不要随意猜一个。
- 是否添加开源许可证。公开可见不等同于授予开源许可，本项目整理时未自动添加许可证。
- 确認暂存文件列表没有个人收藏或登录信息，之后才创建提交和远程仓库。

推荐首次上传使用私有仓库，验收之后再决定是否公开。不得把个人访问令牌写在 Git 远程 URL、README 或脚本中；使用 GitHub CLI/系统凭据管理器等受支持的登录方式。

## 持续检查

`.github/workflows/ci.yml` 在 push/PR 时运行基本测试与发布检查，不使用真实平台账号。新增源码或文档时，也需将其加入白名单，否则不会出现在发布 ZIP 中；CI 会拒绝 Git 索引中的未允许文件。

检查器只覆盖当前文件及索引，**不能保证清理过去提交中的秘密**。已有历史的仓库应单独扫描完整历史。若发现泄露，先吊销凭据，再参照 [SECURITY.md](../SECURITY.md) 处理。

不要对敏感文件执行 `git add -f`。ZIP 也不应包含 `.git/`，以免顺带暴露历史、远程地址或本地仓库配置。
