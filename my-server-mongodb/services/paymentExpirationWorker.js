const { expireDuePayments } = require('./paymentLifecycleService');

const EXPIRATION_INTERVAL_MS = 60 * 1000;

function startPaymentExpirationWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await expireDuePayments();
    } catch (error) {
      console.error('Không thể xử lý Payment hết hạn:', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, EXPIRATION_INTERVAL_MS);
  timer.unref();
  void run();

  return () => clearInterval(timer);
}

module.exports = { startPaymentExpirationWorker };
