const nodemailer = require('nodemailer');

function createTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS;

  if (user && pass) {
    if (process.env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user, pass }
      });
    }

    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
  }

  return null;
}

/**
 * Gửi email chứa mã OTP xác thực
 * @param {string} toEmail Email người nhận
 * @param {string} name Tên người nhận
 * @param {string} otp Mã OTP 6 chữ số
 * @param {'register' | 'reset-password'} purpose Mục đích xác thực
 */
async function sendOtpEmail(toEmail, name, otp, purpose = 'register') {
  const transporter = createTransporter();

  console.log('\n======================================================');
  console.log(`[URII OTP EMAIL] Mục đích: ${purpose === 'reset-password' ? 'ĐẶT LẠI MẬT KHẨU' : 'ĐĂNG KÝ TÀI KHOẢN'}`);
  console.log(`[URII OTP EMAIL] Đang gửi OTP tới: ${toEmail}`);
  console.log(`[URII OTP EMAIL] Mã OTP xác thực: ${otp} (Thời hạn 60 giây)`);
  console.log('======================================================\n');

  if (!transporter) {
    console.log('[URII OTP EMAIL] Lưu ý: Chưa cấu hình EMAIL_USER và EMAIL_APP_PASSWORD trong .env nên mã OTP được in ra terminal ở trên để kiểm thử.');
    return { success: true, simulated: true };
  }

  const isReset = purpose === 'reset-password';
  const subtitle = isReset ? 'Yêu cầu đặt lại mật khẩu' : 'Xác thực tài khoản của bạn';
  const messageBody = isReset
    ? 'Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản tại <strong>Urii</strong>. Dưới đây là mã xác thực OTP của bạn để hoàn tất việc đổi mật khẩu mới:'
    : 'Cảm ơn bạn đã đăng ký tài khoản tại <strong>Urii</strong>. Dưới đây là mã xác thực OTP của bạn để hoàn tất việc đăng ký:';
  const subject = isReset
    ? `[Urii] Mã OTP đặt lại mật khẩu: ${otp}`
    : `[Urii] Mã xác thực OTP đăng ký tài khoản: ${otp}`;

  const htmlContent = `
    <div style="font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e8e8e8; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #840001; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 1px;">URII</h1>
        <p style="color: #666; font-size: 14px; margin: 4px 0 0;">${subtitle}</p>
      </div>
      
      <p style="font-size: 15px; color: #333; line-height: 1.6;">
        Xin chào <strong>${name || 'bạn'}</strong>,
      </p>
      <p style="font-size: 15px; color: #555; line-height: 1.6;">
        ${messageBody}
      </p>

      <div style="background-color: #fdf2f2; border: 2px dashed #840001; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
        <span style="font-size: 36px; font-weight: bold; color: #840001; letter-spacing: 8px; font-family: monospace;">${otp}</span>
      </div>

      <div style="background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin-bottom: 24px;">
        <p style="margin: 0; color: #b45309; font-size: 13.5px; line-height: 1.5;">
          ⏱️ <strong>Lưu ý quan trọng:</strong> Mã xác thực chỉ có hiệu lực trong vòng <strong>60 giây (1 phút)</strong>. Sau thời gian này mã sẽ tự động hết hiệu lực.
        </p>
      </div>

      <p style="font-size: 13px; color: #777; line-height: 1.5;">
        Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.
      </p>

      <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 24px 0 16px;" />
      
      <p style="font-size: 12px; color: #999; text-align: center; margin: 0;">
        © ${new Date().getFullYear()} Urii Handmade. Tất cả các quyền được bảo lưu.
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Urii Handmade" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent
    });
    console.log('[URII OTP EMAIL] Email đã được gửi thành công. MessageId:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[URII OTP EMAIL] Lỗi gửi email qua SMTP:', error);
    return { success: true, error: error.message };
  }
}

module.exports = {
  sendOtpEmail
};
