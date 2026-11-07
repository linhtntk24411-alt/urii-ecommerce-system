const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

// Hàm gửi OTP
const sendOTPEmail = async (email, otp) => {
  await transporter.sendMail({
    from: `"Urii Handmade" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Mã xác thực tài khoản Urii",
    html: `
      <div style="font-family: Arial; padding: 20px;">
        <h2>Chào mừng bạn đến với Urii!</h2>

        <p>Mã xác thực tài khoản của bạn là:</p>

        <h1 style="color: #b90000; letter-spacing: 8px;">
          ${otp}
        </h1>

        <p>Mã OTP có hiệu lực trong 5 phút.</p>

        <p>Trân trọng,<br>Đội ngũ Urii</p>
      </div>
    `
  });
};

module.exports = {
  transporter,
  sendOTPEmail
};
