# 本地模型

LocalProductDraft：key（身份元组+会话 UUID）、identityKey（org/workspace/user/entity/editorType）、schemaVersion=1、baseRevision、original、form、updatedAt。新商品 entityId=new，已有商品使用不可编辑的 SKU。无需新增数据库表。

状态：检查草稿 → 恢复/放弃决策 → 编辑 → 正在暂存/已暂存/失败 → 正式保存 → 成功清理。409 → 保留草稿 → 读取最新 → 手动恢复+人工核对 → 再次显式保存。取消确认 → 删除当前会话草稿 → 退出。刷新/卸载仅尽力 flush，不删除。

附件只存 ID、URL、元数据；不重复上传，不存文件 Blob/凭据。未知格式保留并报错，不自动迁移覆盖。
