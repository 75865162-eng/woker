import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

const apply = process.argv.includes("--apply");
const organizationId = readArg("organizationId");
const workspaceId = readArg("workspaceId");

async function main() {
  const result = await prisma.$transaction(async (transaction) => {
    const whereClause = Prisma.sql`
      LOWER(BTRIM("sku")) LIKE 'amzn.gr.%'
      ${organizationId ? Prisma.sql`AND "organizationId" = ${organizationId}` : Prisma.empty}
      ${workspaceId ? Prisma.sql`AND "workspaceId" = ${workspaceId}` : Prisma.empty}
    `;
    const groups = await transaction.$queryRaw<Array<{ organizationId: string; workspaceId: string; count: bigint }>>(
      Prisma.sql`
        SELECT "organizationId", "workspaceId", COUNT(*)::bigint AS "count"
        FROM "ProductRecord"
        WHERE ${whereClause}
        GROUP BY "organizationId", "workspaceId"
        ORDER BY "organizationId", "workspaceId"
      `,
    );
    const matchedCount = groups.reduce((total, group) => total + Number(group.count), 0);

    if (!apply) {
      return { groups, matchedCount, deletedCount: 0, remainingCount: matchedCount };
    }

    const deletedCount = await transaction.$executeRaw(
      Prisma.sql`
        DELETE FROM "ProductRecord"
        WHERE ${whereClause}
      `,
    );

    const remaining = await transaction.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "ProductRecord"
        WHERE ${whereClause}
      `,
    );

    return {
      groups,
      matchedCount,
      deletedCount,
      remainingCount: Number(remaining[0]?.count ?? BigInt(0)),
    };
  });

  console.log(`amzn.gr. ProductRecord cleanup ${apply ? "applied" : "dry-run"}: matched=${result.matchedCount}, deleted=${result.deletedCount}, remaining=${result.remainingCount}`);
  console.log(`scope: organizationId=${organizationId || "ALL"}, workspaceId=${workspaceId || "ALL"}`);
  console.log(
    JSON.stringify(
      result.groups.map((group) => ({
        organizationId: group.organizationId,
        workspaceId: group.workspaceId,
        count: Number(group.count),
      })),
      null,
      2,
    ),
  );
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
