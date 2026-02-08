import nodemailer from "nodemailer";

const smtpPort = Number(process.env.SMTP_PORT) || 587;
const maxMailPerDay = Number(process.env.MAX_MAIL_PER_DAY) || 5000;
let dailyMailCount = 0;
let dailyMailDate = new Date().toDateString();
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "email-smtp.ap-south-1.amazonaws.com",
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const checkDailyLimit = () => {
    const today = new Date().toDateString();
    if (dailyMailDate !== today) {
        dailyMailDate = today;
        dailyMailCount = 0;
    }
    if (dailyMailCount >= maxMailPerDay) {
        throw new Error("Daily email limit reached. Email sending blocked.");
    }
    dailyMailCount += 1;
};

const sendEmail = async ({ to, subject, body }) => {
    console.log(to, subject, body);
    checkDailyLimit();
    const response = await transporter.sendMail({
        from: process.env.SENDER_EMAIL,
        to,
        subject,
        html: body,
    });
    return response;
};

export default sendEmail;
