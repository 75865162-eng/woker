# Validation guide
运行 npm run check:fast。打开 /agents/orchestrator 生成计划，打开 Market；带报告时人工确认逐段交接至 Listing，再送 Launch。未批准 PPC 保持 blocked_until_launch；批准后打开 PPC 运行建议。直接篡改 launchApproved/approvalId、换工作区应失败。Round B selection 返回明确未实现。真实 AI/SellerSprite 需有效服务配置，不把 mock 当真实采集验收。
