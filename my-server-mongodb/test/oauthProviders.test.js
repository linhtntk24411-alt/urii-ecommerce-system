const assert = require('node:assert/strict');
const { afterEach, mock, test } = require('node:test');
const oauthProviders = require('../services/oauthProviders');

const originalEnvironment = new Map(
  [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_CALLBACK_URL',
    'FACEBOOK_OAUTH_CLIENT_ID',
    'FACEBOOK_OAUTH_CLIENT_SECRET',
    'FACEBOOK_OAUTH_CALLBACK_URL',
    'FACEBOOK_GRAPH_VERSION'
  ].map((name) => [name, process.env[name]])
);

afterEach(() => {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configureProvider(provider) {
  const prefix = provider.toUpperCase();
  process.env[`${prefix}_OAUTH_CLIENT_ID`] = `${provider}-client`;
  process.env[`${prefix}_OAUTH_CLIENT_SECRET`] = `${provider}-secret`;
  process.env[`${prefix}_OAUTH_CALLBACK_URL`] = (
    `http://localhost:3002/api/auth/oauth/${provider}/callback`
  );
}

test('OAuth authorization URLs require configured providers and use callback state', () => {
  configureProvider('google');
  const authorizationUrl = new URL(oauthProviders.buildAuthorizationUrl('google', 'state-value'));

  assert.equal(authorizationUrl.origin, 'https://accounts.google.com');
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'google-client');
  assert.equal(
    authorizationUrl.searchParams.get('redirect_uri'),
    'http://localhost:3002/api/auth/oauth/google/callback'
  );
  assert.equal(authorizationUrl.searchParams.get('state'), 'state-value');
  assert.throws(
    () => oauthProviders.buildAuthorizationUrl('facebook', 'state-value'),
    { code: 'OAUTH_CONFIGURATION_ERROR' }
  );

  configureProvider('facebook');
  const facebookUrl = new URL(oauthProviders.buildAuthorizationUrl('facebook', 'facebook-state'));
  assert.equal(facebookUrl.origin, 'https://www.facebook.com');
  assert.equal(facebookUrl.pathname, '/v26.0/dialog/oauth');
  assert.equal(facebookUrl.searchParams.get('state'), 'facebook-state');
});

test('Google OAuth exchanges the code and reads its verified profile', async () => {
  configureProvider('google');
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const body = requests.length === 1
      ? { access_token: 'google-access-token' }
      : {
        sub: 'google-provider-id',
        email: 'google.user@example.test',
        email_verified: true,
        name: 'Google User',
        picture: 'https://example.test/google.jpg'
      };
    return { ok: true, json: async () => body };
  });

  try {
    const identity = await oauthProviders.exchangeAuthorizationCode('google', 'auth-code');
    assert.deepEqual(identity, {
      providerUserId: 'google-provider-id',
      email: 'google.user@example.test',
      emailVerified: true,
      name: 'Google User',
      picture: 'https://example.test/google.jpg'
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.method, 'POST');
    assert.match(requests[0].options.body.toString(), /code=auth-code/);
    assert.equal(requests[1].options.headers.Authorization, 'Bearer google-access-token');
  } finally {
    fetchMock.mock.restore();
  }
});

test('Facebook OAuth exchanges the code and reads its profile', async () => {
  configureProvider('facebook');
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const body = requests.length === 1
      ? { access_token: 'facebook-access-token' }
      : {
        id: 'facebook-provider-id',
        email: 'facebook.user@example.test',
        name: 'Facebook User',
        picture: { data: { url: 'https://example.test/facebook.jpg' } }
      };
    return { ok: true, json: async () => body };
  });

  try {
    const identity = await oauthProviders.exchangeAuthorizationCode('facebook', 'auth-code');
    assert.deepEqual(identity, {
      providerUserId: 'facebook-provider-id',
      email: 'facebook.user@example.test',
      emailVerified: false,
      name: 'Facebook User',
      picture: 'https://example.test/facebook.jpg'
    });
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /v26\.0\/oauth\/access_token/);
    assert.match(requests[0].url, /client_secret=facebook-secret/);
    assert.equal(requests[1].options.headers.Authorization, 'Bearer facebook-access-token');
  } finally {
    fetchMock.mock.restore();
  }
});
