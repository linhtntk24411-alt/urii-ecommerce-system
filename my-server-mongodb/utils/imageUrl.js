function isValidImageUrl(value) {
  if (typeof value !== 'string' || !value) {
    return false;
  }

  if (value.startsWith('/images/')) {
    if (value.includes('\\') || value.includes('?') || value.includes('#') || /[\u0000-\u001f]/.test(value)) {
      return false;
    }
    const segments = value.split('/').slice(1);
    return segments[0] === 'images'
      && segments.length > 1
      && segments.every((segment) => segment && segment !== '.' && segment !== '..');
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

module.exports = { isValidImageUrl };
