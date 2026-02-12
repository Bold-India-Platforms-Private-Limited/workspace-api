# Project Management Server (Node + Express + Prisma)

This is the backend API for the Project Management app.

## Tech Stack
- Node.js + Express
- Prisma ORM (PostgreSQL)
- JWT Authentication
- Nodemailer (email)

## Prerequisites
- Node.js 18+ (recommended)
- PostgreSQL database (Neon, local, or any managed Postgres)


## Environment Variables
Create a `.env` file in the project root with the following (example values for AWS PGAdmin database):

PORT=5000
JWT_SECRET=your_jwt_secret
DATABASE_URL=postgresql://devteam:RiseRise4050@13.201.126.92:5432/29JanDB?sslmode=disable
DIRECT_URL=postgresql://devteam:RiseRise4050@13.201.126.92:5432/29JanDB?sslmode=disable

# Admin bootstrap login
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=strongpassword

# SMTP (AWS SES recommended for invitations)
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your_ses_smtp_user
SMTP_PASS=your_ses_smtp_password
SENDER_EMAIL=your_verified_sender_email

# Cloudinary (attendance uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

Notes:
- DATABASE_URL is used by Prisma and the app.
- DIRECT_URL is required by Prisma for direct DB access.
- If SMTP variables are not set, email sending will fail for invitations.
- For AWS SES, use the SMTP credentials from the SES console and a verified sender email.


## Install & Run (Local)
1) Install dependencies
   npm install

2) Generate Prisma client
   npx prisma generate

3) Run migrations to your AWS PGAdmin database
   npx prisma migrate deploy

   (If you want to create a new migration, use: npx prisma migrate dev --name <migration_name>)

4) Start the server
   npm run server

The API runs on http://localhost:5000 by default.

## How to verify tables in AWS PGAdmin

1. Open PGAdmin and connect to your AWS database using:
   - Host: 13.201.126.92
   - Port: 5432
   - Username: devteam
   - Password: RiseRise4050
   - Database: 29JanDB

2. Expand the database tree and navigate to `Schemas > public > Tables` to see all tables created by Prisma migrations.

3. If you do not see the tables, ensure you have run the migrations (see step 3 above).

## Scripts
- npm run server — start dev server (nodemon)
- npm start — start production server

## API Base
All API routes are served under:
- /api/auth
- /api/workspaces
- /api/projects
- /api/tasks
- /api/groups
- /api/comments

## Admin Login
Use ADMIN_EMAIL and ADMIN_PASSWORD to sign in as an admin.
The admin user is created automatically on first login if it does not exist.
