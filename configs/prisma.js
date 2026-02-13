import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

// --- PrismaClient Singleton ---
let prisma;
if (process.env.NODE_ENV === "development") {
	if (!global.prisma) {
		global.prisma = new PrismaClient();
	}
	prisma = global.prisma;
} else {
	// In production, attach to globalThis to ensure singleton
	if (!globalThis._prisma) {
		globalThis._prisma = new PrismaClient();
	}
	prisma = globalThis._prisma;
}

prisma
	.$connect()
	.then(() => console.log("Database connected (Prisma)"))
	.catch((error) => console.log("Database connection failed (Prisma)", error));

// --- pg Pool Singleton ---
let pool;
if (process.env.NODE_ENV === "development") {
	if (!global.pgPool) {
		global.pgPool = new Pool({
			connectionString: process.env.DATABASE_URL,
			application_name: process.env.PGAPPNAME,
			max: process.env.PGPOOL_MAX,
			idleTimeoutMillis: process.env.PGPOOL_IDLE_TIMEOUT,
		});
		global.pgPool.on("connect", () => {
			console.log("PostgreSQL pool connected");
		});
		global.pgPool.on("error", (err) => {
			console.error("PostgreSQL pool error", err);
		});
	}
	pool = global.pgPool;
} else {
	if (!globalThis._pgPool) {
		globalThis._pgPool = new Pool({
			connectionString: process.env.DATABASE_URL,
			application_name: process.env.PGAPPNAME,
			max: process.env.PGPOOL_MAX,
			idleTimeoutMillis: process.env.PGPOOL_IDLE_TIMEOUT,
		});
		globalThis._pgPool.on("connect", () => {
			console.log("PostgreSQL pool connected");
		});
		globalThis._pgPool.on("error", (err) => {
			console.error("PostgreSQL pool error", err);
		});
	}
	pool = globalThis._pgPool;
}

export { prisma, pool };
