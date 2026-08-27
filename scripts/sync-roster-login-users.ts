import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { normalizeAccountRoleId } from "@/lib/accounts/team-roster";
import { syncRosterLoginUsers } from "@/lib/accounts/roster-auth-sync";

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

const connectionString = requiredEnv("DATABASE_URL");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const organizationIds = await prisma.teamRosterMember.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });

  for (const { organizationId } of organizationIds) {
    const accounts = await prisma.teamRosterMember.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        roleId: true,
      },
    });

    await syncRosterLoginUsers(
      prisma,
      accounts.map((account) => ({
        ...account,
        username: undefined,
        phone: account.phone ?? undefined,
        roleId: normalizeAccountRoleId(account.roleId),
        organizationId,
      })),
    );
  }

  console.log(`Synced ${organizationIds.length} organization roster sets into login users.`);
}

void main().finally(() => prisma.$disconnect());
