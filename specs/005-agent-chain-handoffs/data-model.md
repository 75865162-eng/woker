# Data model
交接在原 payload 增加 _handoff：version/kind/from/to/organizationId/userId/workspaceId/sourceExecutionId/planId/createdAt。保留原业务字段。LaunchApproval 引用 approvalId、executionId、planId。均复用现有 execution JSON 与审批表，不迁移数据库。
