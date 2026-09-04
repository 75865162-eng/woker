import type { PermissionAction, RolePermissions } from "@/lib/accounts/permissions";

export type RoleDefinition = {
  id: string;
  name: string;
  description: string;
  permissions: RolePermissions;
  availableByDefault: boolean;
};

export const roleDefinitions: RoleDefinition[] = [
  {
    id: "owner",
    name: "超级管理员",
    description: "全局配置、账号、权限与审计管理",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "database_admin",
    name: "数据库管理员",
    description: "维护账号、权限、系统设置和数据治理，不默认拥有业务审批权",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "operations_supervisor",
    name: "主管",
    description: "管理业务流转、成员分工和审批",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "operations",
    name: "运营",
    description: "负责 SKU 运营确认、资料完善和后续转交",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "operations_assistant",
    name: "运营助理",
    description: "协助维护商品资料和运营任务",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "developer",
    name: "选品",
    description: "负责新品选品、供应商资料和选品信息维护",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "designer",
    name: "美工",
    description: "处理分配给自己的商品图片和视觉资料",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "warehouse",
    name: "仓管",
    description: "处理入库、出库、箱规和货件资料",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "finance",
    name: "财务",
    description: "查看业务数据并导出财务所需资料",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "warehouse_supervisor",
    name: "仓库主管",
    description: "管理仓库作业、物流资料和相关审批",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "viewer",
    name: "查看者",
    description: "只查看工作台、商品、Listing AI 和物流基础数据",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "procurement",
    name: "采购",
    description: "维护采购商品资料并协同物流处理",
    permissions: {},
    availableByDefault: true,
  },
  {
    id: "admin",
    name: "管理员",
    description: "管理业务模块和基础运营配置",
    permissions: {},
    availableByDefault: false,
  },
  {
    id: "operations_manager",
    name: "运营经理",
    description: "统筹 PPC、商品、Listing AI 和物流业务流转",
    permissions: {},
    availableByDefault: false,
  },
  {
    id: "ppc_specialist",
    name: "PPC 专员",
    description: "维护广告工作台和搜索词合并相关任务",
    permissions: {},
    availableByDefault: false,
  },
  {
    id: "listing_specialist",
    name: "Listing 专员",
    description: "维护商品资料、Listing AI 和图片放大任务",
    permissions: {},
    availableByDefault: false,
  },
  {
    id: "logistics_specialist",
    name: "物流专员",
    description: "维护物流模板、箱规和货件导出",
    permissions: {},
    availableByDefault: false,
  },
];

function createPermissions(moduleIds: string[], actions: PermissionAction[]) {
  return Object.fromEntries(moduleIds.map((moduleId) => [moduleId, actions]));
}

export function buildRoleDefinitions(permissionActions: PermissionAction[], moduleIds: string[]) {
  const allActions = permissionActions;
  const fullPermissions = Object.fromEntries(moduleIds.map((moduleId) => [moduleId, allActions]));

  return roleDefinitions.map((role) => {
    switch (role.id) {
      case "owner":
        return { ...role, permissions: fullPermissions };
      case "database_admin":
        return {
          ...role,
          permissions: createPermissions(
            ["products", "workspace", "searchMerge", "listingAi", "imageUpscale", "logistics", "tasks", "history", "versions", "accounts", "settings"],
            ["view", "create", "edit", "export"],
          ),
        };
      case "admin":
      case "operations_manager":
        return {
          ...role,
          permissions: createPermissions(
            ["products", "workspace", "searchMerge", "listingAi", "agents", "imageUpscale", "logistics", "tasks", "history"],
            allActions,
          ),
        };
      case "operations_supervisor":
        return { ...role, permissions: createPermissions(["products", "listingAi", "agents", "imageUpscale", "tasks"], ["view", "create", "edit", "approve", "export"]) };
      case "operations":
        return { ...role, permissions: createPermissions(["products", "listingAi", "agents"], ["view", "create", "edit", "export"]) };
      case "operations_assistant":
        return { ...role, permissions: createPermissions(["products", "listingAi", "agents"], ["view", "create", "edit"]) };
      case "developer":
        return { ...role, permissions: createPermissions(["products", "logistics", "agents"], ["view", "create", "edit", "export"]) };
      case "designer":
        return { ...role, permissions: createPermissions(["products", "listingAi", "agents", "imageUpscale"], ["view"]) };
      case "warehouse":
        return { ...role, permissions: createPermissions(["logistics"], ["view", "create", "edit", "export"]) };
      case "finance":
        return { ...role, permissions: createPermissions(["products", "workspace", "agents", "logistics", "history"], ["view", "export"]) };
      case "warehouse_supervisor":
        return { ...role, permissions: createPermissions(["logistics"], ["view", "create", "edit", "approve", "export"]) };
      case "procurement":
        return { ...role, permissions: createPermissions(["products", "agents", "logistics"], ["view", "create", "edit", "export"]) };
      case "ppc_specialist":
        return { ...role, permissions: createPermissions(["workspace", "searchMerge", "agents"], ["view", "create", "edit", "export"]) };
      case "listing_specialist":
        return { ...role, permissions: createPermissions(["products", "listingAi", "agents", "imageUpscale"], ["view", "create", "edit", "export"]) };
      case "logistics_specialist":
        return { ...role, permissions: createPermissions(["logistics"], ["view", "create", "edit", "export"]) };
      case "viewer":
        return { ...role, permissions: createPermissions(["agents"], ["view"]) };
      default:
        return role;
    }
  });
}
