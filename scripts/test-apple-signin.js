/**
 * Local test harness for POST /auth/apple.
 *
 * It stands up a mock of Apple's JWKS endpoint, mints identity tokens signed
 * with a throwaway key, and calls the running backend. Nothing here talks to
 * Apple.
 *
 * Usage (two terminals):
 *   1) docker compose up -d
 *      APPLE_JWKS_URL_OVERRIDE=http://localhost:9911/keys npm run dev
 *   2) node scripts/test-apple-signin.js
 *
 * Optional env: API_BASE (default http://localhost:4000/api/v1)
 */
const http = require('http');
const { generateKeyPairSync, createHash, randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'co.za.errands.app';
const JWKS_PORT = 9911;
const KID = 'test-key-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

function mintToken(overrides = {}) {
  const rawNonce = randomUUID();
  const hashedNonce = createHash('sha256').update(rawNonce).digest('hex');
  const claims = {
    iss: 'https://appleid.apple.com',
    aud: BUNDLE_ID,
    sub: overrides.sub || `000123.${randomUUID().replace(/-/g, '').slice(0, 16)}.1234`,
    email: overrides.email || `qa_${Date.now()}@privaterelay.appleid.com`,
    email_verified: 'true',
    is_private_email: 'true',
    nonce: overrides.nonce === null ? undefined : hashedNonce,
    ...overrides.claims,
  };
  const token = jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    keyid: KID,
    expiresIn: overrides.expiresIn || '10m',
  });
  return { token, rawNonce, claims };
}

async function call(body) {
  try {
    const res = await axios.post(`${API_BASE}/auth/apple`, body, { validateStatus: () => true });
    return { status: res.status, data: res.data };
  } catch (err) {
    return { status: 'NETWORK_ERROR', data: err.message };
  }
}

async function main() {
  const server = http
    .createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    })
    .listen(JWKS_PORT);
  console.log(`mock JWKS on http://localhost:${JWKS_PORT}/keys`);
  console.log(`hitting ${API_BASE}/auth/apple`);
  console.log('---');

  // 1. Happy path — brand new Apple identity
  {
    const { token, rawNonce } = mintToken();
    const r = await call({
      identityToken: token,
      rawNonce,
      fullName: { givenName: 'Ada', familyName: 'Lovelace' },
      email: 'qa+first@privaterelay.appleid.com',
    });
    console.log('1) new identity        ->', r.status, JSON.stringify(r.data).slice(0, 240));
  }

  // 2. Full first-time flow: sign in -> complete-signup -> sign in again (now a
  //    returning user, should get real tokens with no name/email in the request)
  const stableSub = `000999.${randomUUID().replace(/-/g, '').slice(0, 16)}.5678`;
  const stableEmail = `qa_stable_${Date.now()}@example.com`;
  {
    const { token, rawNonce } = mintToken({ sub: stableSub, email: stableEmail });
    const r1 = await call({ identityToken: token, rawNonce, fullName: { givenName: 'Grace', familyName: 'Hopper' } });
    console.log('2a) first sign-in         ->', r1.status, JSON.stringify(r1.data).slice(0, 200));

    const creationToken = r1.data?.data?.creationToken;
    if (creationToken) {
      const done = await axios.post(
        `${API_BASE}/auth/oauth/complete-signup`,
        { creationToken, role: 'user' },
        { validateStatus: () => true },
      );
      console.log('2b) complete-signup(user) ->', done.status, JSON.stringify(done.data).slice(0, 160));
    }

    const { token: t2, rawNonce: n2 } = mintToken({ sub: stableSub, email: stableEmail });
    const r2 = await call({ identityToken: t2, rawNonce: n2, fullName: null, email: null });
    const hasTokens = Boolean(r2.data?.data?.tokens?.accessToken);
    console.log('2c) returning sign-in     ->', r2.status, `hasTokens=${hasTokens}`, JSON.stringify(r2.data).slice(0, 160));
  }

  // 3. Nonce mismatch — must reject
  {
    const { token } = mintToken();
    const r = await call({ identityToken: token, rawNonce: 'not-the-real-nonce' });
    console.log('3) bad nonce           ->', r.status, JSON.stringify(r.data).slice(0, 160));
  }

  // 4. Wrong audience — must reject
  {
    const { token, rawNonce } = mintToken({ claims: { aud: 'com.someone.else' } });
    const r = await call({ identityToken: token, rawNonce });
    console.log('4) wrong audience      ->', r.status, JSON.stringify(r.data).slice(0, 160));
  }

  // 5. Expired token — must reject
  {
    const { token, rawNonce } = mintToken({ expiresIn: '-1m' });
    const r = await call({ identityToken: token, rawNonce });
    console.log('5) expired token       ->', r.status, JSON.stringify(r.data).slice(0, 160));
  }

  // 6. Garbage token — must reject
  {
    const r = await call({ identityToken: 'not.a.jwt', rawNonce: 'x' });
    console.log('6) garbage token       ->', r.status, JSON.stringify(r.data).slice(0, 160));
  }

  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
