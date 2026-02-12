import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

// Pool configuration from environment variables
const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	application_name: process.env.PGAPPNAME,
	max: process.env.PGPOOL_MAX,
	idleTimeoutMillis: process.env.PGPOOL_IDLE_TIMEOUT,
});

pool.on("connect", () => {
	console.log("PostgreSQL pool connected");
});
pool.on("error", (err) => {
	console.error("PostgreSQL pool error", err);
});

const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV === "development") global.prisma = prisma;

prisma
	.$connect()
	.then(() => console.log("Database connected (Prisma)"))
	.catch((error) => console.log("Database connection failed (Prisma)", error));

export { prisma, pool };
