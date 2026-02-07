import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../configs/prisma.js";

const signToken = (user, role) => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
    }
    return jwt.sign(
        { userId: user.id, email: user.email, role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};

const ensureAdminUser = async (email) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    const created = await prisma.user.create({
        data: {
            id: crypto.randomUUID(),
            email,
            name: "Admin",
            image: "",
        },
    });

    return created;
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (email === adminEmail && password === adminPassword) {
            const adminUser = await ensureAdminUser(email);
            const token = signToken(adminUser, "ADMIN");
            return res.json({ token, user: adminUser, role: "ADMIN" });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const token = signToken(user, "MEMBER");
        res.json({ token, user, role: "MEMBER" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};