import type { AccountRoleId, TeamMemberStatus } from "@/lib/accounts/team-roster";

export type AccountWorkbookRecord = {
  id?: string;
  username?: string;
  name: string;
  email?: string;
  department: string;
  title: string;
  roleId: AccountRoleId;
  status: TeamMemberStatus;
  lastActiveAt?: string;
  amazonStorePermissions?: string;
  multiPlatformStorePermissions?: string;
  phone?: string;
  lastLoginIp?: string;
  lastLoginAt?: string;
  sourceCreatedAt?: string;
};

type AccountWorkbookParseResult = {
  accounts: AccountWorkbookRecord[];
  errors: string[];
};

const headers = [
  "用户名",
  "姓名",
  "角色",
  "亚马逊店铺数量",
  "亚马逊店铺权限",
  "多平台店铺数量",
  "多平台店铺权限",
  "仓库数量",
  "仓库权限",
  "数据范围组",
  "1688账号数量",
  "1688账号权限",
  "手机号",
  "邮箱",
  "状态",
  "登录次数",
  "最近登录IP",
  "最近登录时间",
  "创建时间",
];

const statusByValue: Record<string, TeamMemberStatus> = {
  active: "active",
  在线: "active",
  已启用: "active",
  pending: "pending",
  待激活: "pending",
  disabled: "disabled",
  已停用: "disabled",
  已禁用: "disabled",
};

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function buildRoleLookup(roleLabels: Record<AccountRoleId, string>) {
  const lookup = new Map<string, AccountRoleId>(
    Object.entries(roleLabels).flatMap(([roleId, label]) => [
      [roleId, roleId as AccountRoleId],
      [label, roleId as AccountRoleId],
    ]),
  );
  [
    ["管理员", "database_admin"],
    ["运营", "operations"],
    ["运营助理", "operations_assistant"],
    ["开发", "developer"],
    ["美工", "designer"],
    ["仓管", "warehouse"],
    ["仓管员", "warehouse"],
    ["选品", "procurement"],
    ["运营主管", "operations_supervisor"],
    ["主管助理", "operations_supervisor"],
    ["查看", "viewer"],
  ].forEach(([label, roleId]) => lookup.set(label, roleId as AccountRoleId));
  return lookup;
}

function getRoleId(value: string, lookup: Map<string, AccountRoleId>) {
  if (lookup.has(value)) return lookup.get(value);

  const parts = value.split(/[,，]/).map((part) => part.trim());
  const exactRole = parts.map((part) => lookup.get(part)).find(Boolean);
  if (exactRole) return exactRole;

  return Array.from(lookup.entries())
    .filter(([label]) => label && value.includes(label))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1];
}

function countPermissions(value?: string) {
  return value?.split(/[,，\n]/).map((part) => part.trim()).filter(Boolean).length || "";
}

export async function exportAccountWorkbook(
  accounts: AccountWorkbookRecord[],
  roleLabels: Record<AccountRoleId, string>,
) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const rows = accounts.map((account) => ({
    用户名: account.username ?? "",
    姓名: account.name,
    角色: roleLabels[account.roleId],
    亚马逊店铺数量: countPermissions(account.amazonStorePermissions),
    亚马逊店铺权限: account.amazonStorePermissions ?? "",
    多平台店铺数量: countPermissions(account.multiPlatformStorePermissions),
    多平台店铺权限: account.multiPlatformStorePermissions ?? "",
    仓库数量: "",
    仓库权限: "",
    数据范围组: "",
    "1688账号数量": "",
    "1688账号权限": "",
    手机号: account.phone ?? "",
    邮箱: account.email ?? "",
    状态: account.status === "active" ? "已启用" : account.status === "pending" ? "待激活" : "已禁用",
    登录次数: "",
    最近登录IP: account.lastLoginIp ?? "",
    最近登录时间: account.lastLoginAt ?? account.lastActiveAt ?? "",
    创建时间: account.sourceCreatedAt ?? "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  worksheet["!cols"] = [
    { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 46 },
    { wch: 14 }, { wch: 46 }, { wch: 14 }, { wch: 30 }, { wch: 18 },
    { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 30 }, { wch: 14 },
    { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "账号列表");

  return new Blob(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
}

export async function parseAccountWorkbookFile(
  file: File,
  roleLabels: Record<AccountRoleId, string>,
): Promise<AccountWorkbookParseResult> {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    throw new Error("请选择 Excel 或 CSV 格式的账号列表文件。");
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!worksheet) throw new Error("文件中没有可读取的工作表。");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false });
  if (!rows.length) throw new Error("文件中没有可导入的账号。");

  const roleLookup = buildRoleLookup(roleLabels);
  const accounts: AccountWorkbookRecord[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = text(row["姓名"]);
    const username = text(row["用户名"]);
    const email = text(row["邮箱"]);
    const roleValue = text(row["角色"] ?? row["系统角色"]);
    const roleId = getRoleId(roleValue, roleLookup);
    const status = statusByValue[text(row["状态"])] ?? "pending";

    if (!name || (!username && !email)) {
      errors.push(`第 ${rowNumber} 行缺少姓名，或缺少用户名和邮箱。`);
      return;
    }
    if (!roleId) {
      errors.push(`第 ${rowNumber} 行的角色无效。`);
      return;
    }

    accounts.push({
      id: text(row["账号 ID"]) || undefined,
      username: username || undefined,
      name,
      email: email || undefined,
      department: text(row["部门"]),
      title: text(row["岗位"]),
      roleId,
      status,
      lastActiveAt: text(row["最近活动"] ?? row["最近登录时间"]) || undefined,
      amazonStorePermissions: text(row["亚马逊店铺权限"]) || undefined,
      multiPlatformStorePermissions: text(row["多平台店铺权限"]) || undefined,
      phone: text(row["手机号"]) || undefined,
      lastLoginIp: text(row["最近登录IP"]) || undefined,
      lastLoginAt: text(row["最近登录时间"]) || undefined,
      sourceCreatedAt: text(row["创建时间"]) || undefined,
    });
  });

  return { accounts, errors };
}
