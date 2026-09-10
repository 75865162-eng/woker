# E2E 测试

这组测试只面向隔离的测试环境和测试账号。测试账号、数据库、文件存储和 API 配置必须与生产环境分开。

## 本地运行

先准备独立测试账号和测试环境变量：

```bash
export E2E_TEST_EMAIL="e2e-test@example.com"
export E2E_TEST_PASSWORD="a-password-at-least-8-characters"
export E2E_BASE_URL="http://127.0.0.1:3000"
npx playwright install
npm run test:e2e
```

不设置 `E2E_BASE_URL` 时，Playwright 会自动启动本地开发服务器，使用 `http://127.0.0.1:3100`。

测试文件位于 `tests/fixtures/`，均为脱敏的小型 CSV，不包含生产数据。不要把测试账号密码、`.env`、生产数据库或生产上传文件提交到仓库。
