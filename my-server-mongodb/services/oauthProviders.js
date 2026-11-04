const OAUTH_PROVIDERS = {
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    profileEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    callbackUrlEnv: 'GOOGLE_OAUTH_CALLBACK_URL',
    scope: 'openid email profile'
  },
  facebook: {
    authorizationEndpoint: 'https://www.facebook.com/{version}/dialog/oauth',
    tokenEndpoint: 'https://graph.facebook.com/{version}/oauth/access_token',
    profileEndpoint: 'https://graph.facebook.com/{version}/me?fields=id,name,email,picture.type(large)',
    clientIdEnv: 'FACEBOOK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_OAUTH_CLIENT_SECRET',
    callbackUrlEnv: 'FACEBOOK_OAUTH_CALLBACK_URL',
    scope: 'email public_profile'
  }
};

class OAuthProviderError extends Error {
  constructor(message, code = 'OAUTH_PROVIDER_ERROR') {
    super(message);
    this.name = 'OAuthProviderError';
    this.code = code;
  }
}

function getProviderConfig(provider) {
  const definition = OAUTH_PROVIDERS[provider];
  if (!definition) {
    throw new OAuthProviderError('OAuth provider is not supported.', 'OAUTH_CONFIGURATION_ERROR');
  }

  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v26.0';
  if (provider === 'facebook' && !/^v\d+\.0$/.test(graphVersion)) {
    throw new OAuthProviderError(
      'Invalid Facebook Graph API version.',
      'OAUTH_CONFIGURATION_ERROR'
    );
  }
  const applyGraphVersion = (endpoint) => endpoint.replace('{version}', graphVersion);
  const clientId = process.env[definition.clientIdEnv];
  const clientSecret = process.env[definition.clientSecretEnv];
  const callbackUrl = process.env[definition.callbackUrlEnv];
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new OAuthProviderError(
      `Missing OAuth settings for ${provider}.`,
      'OAUTH_CONFIGURATION_ERROR'
    );
  }

  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new OAuthProviderError(
      `Invalid OAuth callback URL for ${provider}.`,
      'OAUTH_CONFIGURATION_ERROR'
    );
  }
  if (callback.protocol !== 'https:'
    && !(callback.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(callback.hostname))) {
    throw new OAuthProviderError(
      `OAuth callback URL for ${provider} must use HTTPS.`,
      'OAUTH_CONFIGURATION_ERROR'
    );
  }

  return {
    ...definition,
    authorizationEndpoint: applyGraphVersion(definition.authorizationEndpoint),
    tokenEndpoint: applyGraphVersion(definition.tokenEndpoint),
    profileEndpoint: applyGraphVersion(definition.profileEndpoint),
    clientId,
    clientSecret,
    callbackUrl
  };
}

function buildAuthorizationUrl(provider, state) {
  const config = getProviderConfig(provider);
  const authorizationUrl = new URL(config.authorizationEndpoint);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: config.scope,
    state
  });
  if (provider === 'google') authorizationUrl.searchParams.set('access_type', 'online');
  return authorizationUrl.toString();
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new OAuthProviderError('OAuth provider could not be reached.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new OAuthProviderError('OAuth provider returned an invalid response.');
  }
  if (!response.ok) {
    throw new OAuthProviderError('OAuth provider rejected the authorization request.');
  }
  return body;
}

async function exchangeAuthorizationCode(provider, code) {
  const config = getProviderConfig(provider);
  const tokenUrl = new URL(config.tokenEndpoint);
  const tokenRequest = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    code
  });

  let tokenResponse;
  if (provider === 'google') {
    tokenRequest.set('grant_type', 'authorization_code');
    tokenResponse = await fetchJson(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequest
    });
  } else {
    tokenUrl.search = tokenRequest;
    tokenResponse = await fetchJson(tokenUrl);
  }

  if (typeof tokenResponse.access_token !== 'string' || !tokenResponse.access_token) {
    throw new OAuthProviderError('OAuth provider returned no access token.');
  }
  const profile = await fetchJson(config.profileEndpoint, {
    headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
  });

  if (provider === 'google') {
    return {
      providerUserId: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified === true,
      name: profile.name,
      picture: profile.picture
    };
  }
  return {
    providerUserId: profile.id,
    email: profile.email,
    emailVerified: false,
    name: profile.name,
    picture: profile.picture?.data?.url
  };
}

module.exports = {
  buildAuthorizationUrl,
  exchangeAuthorizationCode
};
