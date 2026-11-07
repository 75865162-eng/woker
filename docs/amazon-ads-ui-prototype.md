# Amazon Ads 广告管理原型

## 入口与边界

- ERP 的 `/workspace` 提供入口；主地址 `/amazon-ads/campaigns`。
- `src/app/amazon-ads/layout.tsx` 沿用现有 AppShell、登录和服务端 PPC `workspace:view` 校验；没有新增角色或变更 ERP 全局导航。
- 广告结构、指标、报告、竞价和预算规则仍由 Mock Fixture/当前会话驱动，不连接广告同步任务或广告写接口。
- `/amazon-ads/accounts` 是独立账户管理页：服务端配置齐备且管理员主动启动后才会进入 Amazon LwA OAuth；回调会调用 Ads token/Profile 只读接口、将加密 refresh token 与 Profile 写入 ERP 数据库。未配置时入口禁用。不得用该页的授权状态推断 Mock 广告指标已经来自真实 Ads 数据。
- `src/lib/amazon-ads/fixtures/catalog.ts` 维护账户、站点、Campaign / Ad Group 与报告 fixture；演示基准日为 2026-11-05。
- `AdsDataProvider.read(AdsQuery)` 是统一数据入口。类型、账户、站点、Campaign、Ad Group、日期在查询中同时生效；KPI 和趋势由同一日事实汇总。比率由汇总事实重新计算，CSV 防止公式注入。

## 可用页面与行为

Campaign 列表/详情、Ad Group 详情、关键词、商品投放、否定投放、搜索词（展示触发关键词/商品投放及匹配类型）、广告位、报告摘要与报告生成下载已提供交互。详情包含竞价调整、预算规则、设置和会话历史；活动历史按账户、站点与 Campaign 精确筛选，仅列出演示会话中属于该 Campaign 的操作。Campaign 每日预算、广告组/关键词竞价支持从表格金额入口编辑，归档记录不允许金额编辑。编辑只改变演示值，不改变历史表现。新建广告组继承父广告类型，并在详情保持空的表现数据。否定投放支持在 Campaign / Ad Group 范围新增、ASIN 格式和重复校验；广告组的否定关键词与否定商品 Tab 固定对应类型。否定投放不展示竞价或 KPI。建议、营销组合模型、品牌提升洞察为明确的规划页。未知路径显示不存在提示。

状态、预算、竞价、创建记录、预算规则和演示报告保留在当前 Ads 布局的内存中，刷新后恢复 fixture。账户/Profile 授权和店铺绑定是服务端持久化设置，不与上述演示状态混用。默认首页与紧凑行高仅保存在当前浏览器标签页 sessionStorage，存储不可用时退化到内存。已保存的基础首页可跨刷新恢复；详情类首页在刷新后回退到 Campaign 列表，以免指向已消失的会话记录。

表格搜索、状态、最低花费筛选作用于表格及其汇总与 CSV；上方 KPI 表示账户/站点/日期/广告类型/Campaign/Ad Group 维度，表内筛选不会改变 KPI。分页最多 100 行，横向滚动保留名称和状态固定列。桌面保留密集布局；600px 以下 Ads 导航为抽屉，账户操作提供更多菜单。ERP 自身窄屏布局不在本模块改动范围。

## 验证

```bash
npx tsx --test tests/amazon-ads.test.ts
npx playwright test --config tests/browser/amazon-ads.config.ts
npm run typecheck
npx eslint src/components/amazon-ads src/lib/amazon-ads src/app/amazon-ads tests/amazon-ads.test.ts tests/browser/amazon-ads*.ts tests/browser/amazon-ads*.tsx
```

浏览器测试使用 esbuild 打包真实组件和 Tailwind/CSS，拦截全部请求，仅允许固定本机 fixture origin，禁止 API 请求。覆盖表格、CSV、层级导航、日期/KPI、账户切换、组合筛选、创建、设置、竞价、预算规则、否定投放新增/重复校验/范围隔离、行内金额编辑、新建品牌推广广告组、偏好刷新与 390/1280/1440/1920 布局。该 harness 不覆盖 Next 服务器路由、真实认证和 ERP 动态通知；上线前需完整 check 和有权限账号的入口验证。

本地截图在 `tmp/amazon-ads-campaign-detail-1440.png` 与 `tmp/amazon-ads-mobile-390.png`，不提交临时产物。

## 后续接入与回退

接入真实 Ads 指标仍需替换 provider，并明确真实 API 的归因窗口、权限、分页和异步错误边界；已核验的 OAuth/API 与未决事项见 `docs/amazon-ads-api-integration.md`。本原型的负向投放不代表真实平台执行结果，生成中的报告是静态状态样例。未增加运行配置或依赖。回退 UI 时保留已创建的授权/账户数据与迁移，不得直接删除；停止访问可先隐藏 Ads UI 并停用相关路由，数据库回滚需另行规划。
