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

if (adminPassword.length < 10 || adminPassword === "change-me-now") {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be changed and contain at least 10 characters.");
}

const organization = await prisma.organization.upsert({
  where: { slug: organizationSlug },
  update: { name: organizationName },
  create: {
    name: organizationName,
    slug: organizationSlug,
  },
});

const existingUser = await prisma.user.findUnique({
  where: { email: adminEmail },
});

const user =
  existingUser ??
  (await prisma.user.create({
    data: {
      email: adminEmail,
      name: "System Admin",
      passwordHash: hashPassword(adminPassword),
    },
  }));

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
