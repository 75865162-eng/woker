import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");

  return `scrypt:${salt}:${hash}`;
}

const connectionString = requiredEnv("DATABASE_URL");
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const organizationName = process.env.BOOTSTRAP_ORG_NAME || "Amazon Operations";
const organizationSlug = process.env.BOOTSTRAP_ORG_SLUG || slugify(organizationName);
const adminEmail = requiredEnv("BOOTSTRAP_ADMIN_EMAIL").trim().toLowerCase();
const adminPassword = requiredEnv("BOOTSTRAP_ADMIN_PASSWORD");

if (process.env.NODE_ENV === "production" && adminPassword.length < 10) {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain at least 10 characters in production.");
}

const organization = await prisma.organization.upsert({
  where: { slug: organizationSlug },
  update: { name: organizationName },
  create: {
    name: organizationName,
    slug: organizationSlug,
  },
});

const user = await prisma.user.upsert({
  where: { email: adminEmail },
  update: {
    name: "Super Admin",
    passwordHash: hashPassword(adminPassword),
    status: "active",
  },
  create: {
    email: adminEmail,
    name: "Super Admin",
    passwordHash: hashPassword(adminPassword),
    status: "active",
  },
});

await prisma.organizationMember.upsert({
  where: {
    organizationId_userId: {
      organizationId: organization.id,
      userId: user.id,
    },
  },
  update: {
    role: "owner",
  },
  create: {
    organizationId: organization.id,
    userId: user.id,
    role: "owner",
  },
});

await prisma.teamRosterMember.upsert({
  where: {
    organizationId_id: {
      organizationId: organization.id,
      id: user.id,
    },
  },
  update: {
    name: user.name,
    email: user.email,
    department: "System",
    title: "Owner",
    roleId: "owner",
    status: "active",
    lastActiveAt: "Bootstrap admin",
    sortOrder: 0,
  },
  create: {
    organizationId: organization.id,
    id: user.id,
    name: user.name,
    email: user.email,
    department: "System",
    title: "Owner",
    roleId: "owner",
    status: "active",
    lastActiveAt: "Bootstrap admin",
    sortOrder: 0,
  },
});

await prisma.auditLog.create({
  data: {
    organizationId: organization.id,
    userId: user.id,
    action: "bootstrap_admin",
    entityType: "User",
    entityId: user.id,
  },
});

await prisma.$disconnect();

console.log(`Seeded admin ${adminEmail} for ${organizationName}.`);
