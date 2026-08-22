import { normalizeAccountRoleId, type TeamAccountRecord } from "@/lib/accounts/team-roster";

const workbookColumns = [
  "id",
  "username",
  "name",
  "email",
  "department",
  "title",
  "roleId",
  "roleName",
  "status",
  "password",
  "lastActiveAt",
  "amazonStorePermissions",
  "multiPlatformStorePermissions",
  "phone",
  "lastLoginIp",
  "lastLoginAt",
  "sourceCreatedAt",
] as const;

function trim(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function getRoleName(roleId: string, roleLabels: Record<string, string>) {
  return roleLabels[roleId] ?? roleId;
}

function normalizeStatus(value: unknown): TeamAccountRecord["status"] {
  const status = trim(value).toLowerCase();
  if (status === "pending" || status === "待激活") return "pending";
  if (status === "disabled" || status === "停用" || status === "已停用") return "disabled";
  return "active";
}

function pickFirst(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      return `${value}`.trim();
    }
  }

  return "";
}

function rowToAccount(row: Record<string, unknown>, index: number, roleLabels: Record<string, string>) {
  const roleLabelToId = new Map(Object.entries(roleLabels).map(([roleId, label]) => [label.trim().toLowerCase(), roleId]));
  const roleValue = pickFirst(row, ["roleId", "role", "系统角色", "角色", "岗位角色"]);
  const resolvedRoleId = normalizeAccountRoleId(roleLabelToId.get(roleValue.trim().toLowerCase()) ?? roleValue);
  const id = pickFirst(row, ["id", "账号ID", "账号 id", "账号编号"]) || `imported-${index + 1}`;
  const name = pickFirst(row, ["name", "姓名", "名称"]);

  if (!name) return { error: `第 ${index + 2} 行缺少姓名。` };

  return {
    account: {
      id,
      username: pickFirst(row, ["username", "用户名", "登录账号"]) || undefined,
      name,
      email: pickFirst(row, ["email", "邮箱"]),
      password: pickFirst(row, ["password", "密码"]) || undefined,
      department: pickFirst(row, ["department", "部门"]) || "未分配",
      title: pickFirst(row, ["title", "岗位", "职务"]) || "未命名岗位",
      roleId: resolvedRoleId,
      status: normalizeStatus(pickFirst(row, ["status", "状态"])),
      lastActiveAt: pickFirst(row, ["lastActiveAt", "最近活动", "最后活跃", "最近活跃"]),
      amazonStorePermissions: pickFirst(row, ["amazonStorePermissions", "Amazon 店铺权限", "Amazon权限"]) || undefined,
      multiPlatformStorePermissions: pickFirst(row, ["multiPlatformStorePermissions", "多平台店铺权限"]) || undefined,
      phone: pickFirst(row, ["phone", "电话", "手机号"]) || undefined,
      lastLoginIp: pickFirst(row, ["lastLoginIp", "最后登录IP"]) || undefined,
      lastLoginAt: pickFirst(row, ["lastLoginAt", "最后登录时间"]) || undefined,
      sourceCreatedAt: pickFirst(row, ["sourceCreatedAt", "创建时间", "来源创建时间"]) || undefined,
    } satisfies TeamAccountRecord,
  };
}

export async function exportAccountWorkbook(accounts: TeamAccountRecord[], roleLabels: Record<string, string>) {
  const XLSX = await import("xlsx");
  const rows = accounts.map((account) => ({
    id: account.id,
    username: account.username ?? "",
    name: account.name,
    email: account.email,
    department: account.department,
    title: account.title,
    roleId: account.roleId,
    roleName: getRoleName(account.roleId, roleLabels),
    status: account.status,
    password: account.password ?? "",
    lastActiveAt: account.lastActiveAt ?? "",
    amazonStorePermissions: account.amazonStorePermissions ?? "",
    multiPlatformStorePermissions: account.multiPlatformStorePermissions ?? "",
    phone: account.phone ?? "",
    lastLoginIp: account.lastLoginIp ?? "",
    lastLoginAt: account.lastLoginAt ?? "",
    sourceCreatedAt: account.sourceCreatedAt ?? "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...workbookColumns] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "账号列表");

  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function parseAccountWorkbookFile(file: File, roleLabels: Record<string, string>) {
  const XLSX = await import("xlsx");
  const workbook = file.name.toLowerCase().endsWith(".csv")
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return { accounts: [] as TeamAccountRecord[], errors: ["未找到可读取的工作表。"] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const accounts: TeamAccountRecord[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const result = rowToAccount(row, index, roleLabels);
    if ("error" in result) {
      errors.push(result.error ?? "导入失败。");
      return;
    }

    accounts.push(result.account);
  });

  return { accounts, errors };
}
