import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
Object.assign(globalThis, { React });
import { renderToStaticMarkup } from "react-dom/server";
import { mergeSavedProductIntoList } from "../src/components/products/product-list-state";
import { initialFilters } from "../src/components/products/product-workbench-model";
import { AccountMembersTable } from "../src/components/accounts/account-members-table";
import { AccountRolePanel } from "../src/components/accounts/account-role-panel";
import { CampaignGroupTable } from "../src/components/workspace/campaign-group-table";
import { ProductEditorForm } from "../src/components/products/product-editor-form";
import { productToDraft } from "../src/components/products/product-workbench-data";
import type { Product } from "../src/lib/products/types";
import type { Account, Role } from "../src/components/accounts/account-workbench-api";

const product = (sku: string, revision: number) => ({ sku, revision, chineseName: `商品${revision}` }) as unknown as Product;

test("商品表单保留基础输入与详情就绪门禁，字段修改通过受控草稿回写", () => {
  let draft = productToDraft(null, [], "SKU-1");
  const noop = () => {};
  const props = {
    draft, setDraft: (action: React.SetStateAction<typeof draft>) => { draft = typeof action === "function" ? action(draft) : action; },
    disabled: false, ready: false, isEditing: true, workspaceId: "workspace-a", selectionOwner: "同事", selectedOps: [], selectedDesigners: [], opsOptions: [], designerOptions: [], patentUploadBusy: false, setPatentUploadBusy: noop, trackWorkbookUpload: noop,
    images: { imageUploads: [], handleImageUpload: async () => {}, cancelImageUpload: noop, retryImageUpload: noop, removeImage: noop },
    attachments: { conclusionUploading: false, conclusionInputRef: { current: null }, openImagePreview: async () => {} },
    workbook: new Proxy({}, { get: () => noop }) as Parameters<typeof ProductEditorForm>[0]["workbook"],
    workflow: { updateStatus: noop, updateAssigneeList: noop, moveWorkflow: noop },
  } satisfies Parameters<typeof ProductEditorForm>[0];
  const tree = ProductEditorForm(props);
  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const element = node as { props?: { label?: string; onChange?: (value: string) => void; children?: unknown } };
    if (element.props?.label === "中文名（必填）") element.props.onChange?.("修改后的商品");
    const children = element.props?.children;
    (Array.isArray(children) ? children.flat(Infinity) : [children]).forEach(visit);
  }
  visit(tree);
  assert.equal(draft.chineseName, "修改后的商品");
  const markup = renderToStaticMarkup(tree);
  assert.match(markup, /专利资料和 workbook 待详情对齐/);
  assert.match(markup, /完整图片附件待详情对齐/);
  assert.ok((markup.match(/disabled=""/g) ?? []).length >= 3);
});

test("保存中的商品在投影追平前保留、按页裁剪，筛选和后页不插入新商品", () => {
  const pending = { product: product("new", 3), isNew: true };
  const input = { filters: initialFilters, page: 1, pageSize: 2 };
  const result = mergeSavedProductIntoList([product("a", 1), product("b", 1)], 2, pending, input);
  assert.deepEqual(result.products.map(row => row.sku), ["new", "a"]);
  assert.equal(result.totalCount, 3);
  assert.equal(result.pending, pending);
  const projected = mergeSavedProductIntoList([product("new", 1)], 3, pending, input);
  assert.equal(projected.products[0].chineseName, "商品3");
  assert.equal(projected.pending, null);
  assert.equal(projected.totalCount, 3);
  for (const restricted of [{ ...input, page: 2 }, { ...input, filters: { ...initialFilters, keyword: "other" } }]) {
    const result = mergeSavedProductIntoList([], 0, pending, restricted);
    assert.equal(result.products.length, 0);
    assert.equal(result.totalCount, 0);
  }
});

test("成员表显示状态、角色、空积分和分页边界，并把操作传给父层", () => {
  const account = { id: "u", name: "同事", roleId: "operations", department: "运营", title: "专员", email: "fixture@example.test", status: "disabled" } as Account;
  const calls: unknown[] = [];
  const props = { accounts: [account], roles: [{ id: "operations", name: "运营" }] as Role[], pointsByUser: {}, total: 1, page: 1, pageCount: 1, firstIndex: 1, lastIndex: 1, onPageChange: () => {}, onRoleChange: (id: string, role: string) => calls.push([id, role]), onEdit: (value: Account) => calls.push(value), onToggleStatus: (id: string) => calls.push(id), onArchive: (id: string) => calls.push(id) };
  const markup = renderToStaticMarkup(createElement(AccountMembersTable, props));
  assert.match(markup, /已停用/);
  assert.match(markup, /启用/);
  assert.match(markup, /1-1 \/ 1 个账号/);
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 2);
  const tree = AccountMembersTable(props);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const element = node as { type?: unknown; props?: { children?: unknown; onChange?: (event: unknown) => void; onClick?: () => void } };
    if (element.type === "select") element.props?.onChange?.({ target: { value: "designer" } });
    if (element.props?.children === "归档") element.props.onClick?.();
    const children = element.props?.children;
    (Array.isArray(children) ? children.flat(Infinity) : [children]).forEach(visit);
  };
  visit(tree);
  assert.deepEqual(calls, [["u", "designer"], "u"]);
});

test("角色矩阵按当前角色权限渲染已选操作并保留保存与版本入口", () => {
  const role = { id: "operations", name: "运营", description: "角色说明", memberCount: 2, sortOrder: 1, permissions: { products: ["view"] } } as Role;
  const markup = renderToStaticMarkup(createElement(AccountRolePanel, { roles: [role], accounts: [], activeRole: role, revision: "r2", savedAt: "", onSelect: () => {}, onAdd: () => {}, onMembers: () => {}, onDelete: () => {}, onSave: () => {}, onUpdate: () => {}, onTogglePermission: () => {}, onToggleModule: () => {} }));
  assert.match(markup, /版本 r2/);
  assert.match(markup, /保存角色/);
  assert.match(markup, /checked=""/);
  assert.match(markup, /查看2名运营成员/);
});

test("广告组合表保持组合运行合并单元格、生命周期和每组上传入口", () => {
  type Model = Parameters<typeof CampaignGroupTable>[0];
  const campaigns = [{ id: "a", campaignName: "Campaign", adGroupName: "A", keywordCount: 2, lifecycleGroupId: "launch" }, { id: "b", campaignName: "Campaign", adGroupName: "B", keywordCount: 3, lifecycleGroupId: "launch" }];
  const unit = { id: "unit", campaignGroupIds: ["a", "b"] };
  const noop = () => {};
  const model = { pagedCampaigns: campaigns, workspaceUnitByCampaignGroupId: new Map([["a", unit], ["b", unit]]), campaignGroupById: new Map(campaigns.map(row => [row.id, row])), getOverallFileName: () => "fixture.csv", lifecycleColumns: [{ id: "launch", label: "新品组" }], exportHistoryCountByCampaignGroupId: new Map(), renderCampaignSortIcon: () => null, toggleCampaignSort: noop, setRuleModalLifecycleId: noop, mergeCampaignGroupsIntoWorkspaceUnit: noop, removeCampaignGroupFromWorkspaceUnit: noop, openDetailRows: noop, toggleLifecycle: noop, selectOverallFiles: noop, runScope: noop, setHistoryScopeIds: noop, blockCampaignGroup: noop } as unknown as Model;
  const markup = renderToStaticMarkup(createElement(CampaignGroupTable, model));
  assert.equal((markup.match(/rowSpan="2"/gi) ?? []).length, 1);
  assert.equal((markup.match(/title="运行规则"/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-pressed="true"/g) ?? []).length, 2);
  assert.equal((markup.match(/title="fixture.csv"/g) ?? []).length, 2);
});
