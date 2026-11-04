const bcrypt = require('bcryptjs');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;
const GENERATED_PASSWORD_MARKER = '$GENERATE';
const DEFAULT_GENERATED_PASSWORD = 'UriiUser@2026Secure';

function isBcryptHash(password) {
  return typeof password === 'string' && BCRYPT_HASH_PATTERN.test(password);
}

async function prepareUserPassword(password, existingPassword) {
  if (password === GENERATED_PASSWORD_MARKER) {
    return existingPassword || bcrypt.hash(DEFAULT_GENERATED_PASSWORD, 10);
  }

  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('User passwords must be non-empty strings.');
  }

  return isBcryptHash(password) ? password : bcrypt.hash(password, 10);
}

module.exports = { isBcryptHash, prepareUserPassword };
