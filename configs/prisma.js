import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV === "development") global.prisma = prisma;

prisma
	.$connect()
	.then(() => console.log("Database connected"))
	.catch((error) => console.log("Database connection failed", error));

export default prisma;
