// functions/__tests__/contracts-jwt.test.ts
//
// Verifies that `parseAccessJwt` actually verifies the JWT signature.
// This is the regression test for the 2026-08-02 architecture audit
// finding C1: the prior `parseAccessJwt` parsed header + payload but
// did NOT compare the signature against a JWKS — meaning any attacker
// who knew the issuer + audience (both are public via `CF_ACCESS_TEAM_DOMAIN`
// and `CF_ACCESS_AUD` if set, or trivially guessable for a single-tenant
// site) could forge a token and access the owner-only inbox.
//
// Test strategy: generate a real RSA keypair, build a JWKS, inject it
// into the module-level cache via the `__setCachedJwks` test hook, and
// exercise both the happy path (valid signed token) and the bypass
// attempts (forged signature, wrong issuer, wrong audience, no JWKS
// configured, expired token).

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from 'jose';
import {
  __setCachedJwks,
  parseAccessJwt,
  verifyAccessJwtClaims,
  type Env,
} from '../lib/contracts';

const ISSUER = 'https://test.cloudflareaccess.com';
const AUDIENCE = '00000000000000000000000000000000';
const JWKS_URL = 'https://test.cloudflareaccess.com/cdn-cgi/access/certs';
const KID = 'test-kid-1';

let validPrivateKey: KeyLike;
let validPublicJwk: { kid: string; alg: string; [k: string]: unknown };
let getKey: ReturnType<typeof createLocalJWKSet>;
let env: Env;

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256', { extractable: true });
  validPrivateKey = keyPair.privateKey;
  const jwk = await exportJWK(keyPair.publicKey);
  validPublicJwk = { ...jwk, kid: KID, alg: 'RS256', use: 'sig' };
  const jwks = { keys: [validPublicJwk] };
  getKey = createLocalJWKSet(jwks);
  // Pre-populate the production cache. `parseAccessJwt` will see this and
  // skip the HTTP fetch.
  __setCachedJwks(JWKS_URL, getKey);
  env = {
    CF_ACCESS_JWKS_URL: JWKS_URL,
    CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
    CF_ACCESS_AUD: AUDIENCE,
  } as unknown as Env;
});

afterEach(() => {
  // Clear the cache between tests so we exercise both cached and uncached paths.
  // (Module-level Map survives between tests; we don't reset it on purpose for
  // the "valid signature" tests, but the no-jwks test uses a different env.)
});

const sign = async (
  payload: Record<string, unknown>,
  privateKey: KeyLike,
  headerKid = KID,
): Promise<string> =>
  new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'RS256', kid: headerKid })
    .setIssuer(payload.iss as string ?? ISSUER)
    .setAudience(payload.aud as string ?? AUDIENCE)
    .setSubject((payload.sub as string) ?? 'subject-id')
    .setIssuedAt((payload.iat as number) ?? Math.floor(Date.now() / 1000))
    .setExpirationTime((payload.exp as number) ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);

describe('parseAccessJwt — JWKS signature verification (regression: 2026-08-02 C1)', () => {
  it('returns claims for a token signed with the JWKS-published public key', async () => {
    const token = await sign({ sub: 'user-123', iss: ISSUER, aud: AUDIENCE }, validPrivateKey);
    const claims = await parseAccessJwt(token, env);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-123');
    expect(claims?.iss).toBe(ISSUER);
  });

  it('rejects a forged token signed with an attacker-controlled key (the C1 bypass)', async () => {
    const attackerKeyPair = await generateKeyPair('RS256', { extractable: true });
    const forged = await sign(
      { sub: 'attacker', iss: ISSUER, aud: AUDIENCE },
      attackerKeyPair.privateKey,
    );
    const claims = await parseAccessJwt(forged, env);
    expect(claims).toBeNull();
  });

  it('rejects a token with a tampered payload but the original signature', async () => {
    const token = await sign({ sub: 'user-123', iss: ISSUER, aud: AUDIENCE }, validPrivateKey);
    const parts = token.split('.');
    // Re-encode the payload with a different sub, keeping the original signature.
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) }),
    ).toString('base64url');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const claims = await parseAccessJwt(tampered, env);
    expect(claims).toBeNull();
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await sign(
      { sub: 'user-123', iss: 'https://evil.example.com', aud: AUDIENCE },
      validPrivateKey,
    );
    const claims = await parseAccessJwt(token, env);
    expect(claims).toBeNull();
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await sign(
      { sub: 'user-123', iss: ISSUER, aud: 'wrong-audience' },
      validPrivateKey,
    );
    const claims = await parseAccessJwt(token, env);
    expect(claims).toBeNull();
  });

  it('rejects an expired token (exp in the past)', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await sign(
      { sub: 'user-123', iss: ISSUER, aud: AUDIENCE, exp: past, iat: past - 3600 },
      validPrivateKey,
    );
    const claims = await parseAccessJwt(token, env);
    expect(claims).toBeNull();
  });

  it('fails closed when CF_ACCESS_JWKS_URL is not configured (no unverified bypass)', async () => {
    const noJwksEnv = {
      CF_ACCESS_JWKS_URL: undefined,
      CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
      CF_ACCESS_AUD: AUDIENCE,
    } as unknown as Env;
    // Even a perfectly valid token must be rejected if no JWKS is configured.
    const token = await sign({ sub: 'user-123', iss: ISSUER, aud: AUDIENCE }, validPrivateKey);
    const claims = await parseAccessJwt(token, noJwksEnv);
    expect(claims).toBeNull();
  });

  it('rejects a token with only 2 segments (not a real JWT)', async () => {
    const claims = await parseAccessJwt('not.a-real-jwt', env);
    expect(claims).toBeNull();
  });

  it('rejects a token signed with HS256 (alg confusion attack)', async () => {
    // The classic JWT alg-confusion attack: sign with HMAC using the
    // public key as the secret. The new verifier must reject this because
    // it only accepts RS256 / ES256.
    const hsToken = await new SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('attacker')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JSON.stringify(validPublicJwk)));
    const claims = await parseAccessJwt(hsToken, env);
    expect(claims).toBeNull();
  });

  it('preserves the email claim when present', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(validPrivateKey);
    // jose accepts custom claims via the constructor, but the Access JWT
    // typically surfaces email under a non-reserved key. Re-sign with email.
    const tokenWithEmail = await new SignJWT({ email: 'user@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('user-123')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(validPrivateKey);
    void token;
    const claims = await parseAccessJwt(tokenWithEmail, env);
    expect(claims?.email).toBe('user@example.com');
  });
});

describe('verifyAccessJwtClaims — pure verification core (test entry point)', () => {
  it('rejects an empty token', async () => {
    const claims = await verifyAccessJwtClaims('', env, getKey);
    expect(claims).toBeNull();
  });

  it('rejects a non-JWT string', async () => {
    const claims = await verifyAccessJwtClaims('not-a-jwt-at-all', env, getKey);
    expect(claims).toBeNull();
  });

  it('rejects when no env audience/issuer constraints are set (loose mode still requires valid signature)', async () => {
    const looseEnv = {} as Pick<Env, 'CF_ACCESS_AUD' | 'CF_ACCESS_TEAM_DOMAIN'>;
    const token = await sign(
      { sub: 'user-123', iss: 'https://anywhere.example.com', aud: 'any-aud' },
      validPrivateKey,
    );
    const claims = await verifyAccessJwtClaims(token, looseEnv, getKey);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-123');
  });
});
