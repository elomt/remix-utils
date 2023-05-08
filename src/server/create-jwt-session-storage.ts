import type {
  Session,
  SessionStorage,
  CookieOptions,
  SessionData,
} from "@remix-run/server-runtime";
import { createSession } from "@remix-run/server-runtime";
import { EncryptJWT, jwtDecrypt, jwtVerify, SignJWT, UnsecuredJWT } from "jose";
import { parse, serialize } from "cookie";

interface JWTSessionStorageOptions {
  cookie: CookieOptions & { name: string };
  encrypt?: boolean;
  sign?: boolean;
}

interface JWTSessionStorage extends SessionStorage {
  getJWT(
    cookieHeader?: string | null,
    options?: CookieOptions
  ): Promise<string | null>;
}

export function createJWTSessionStorage({
  cookie,
  encrypt,
  sign,
}: JWTSessionStorageOptions): JWTSessionStorage {
  let secret = cookie.secrets?.[0];

  async function encodeJWT(data: SessionData, expires?: Date) {
    let encoded;

    if (encrypt && secret) {
      encoded = new EncryptJWT({ data })
        .setProtectedHeader({ alg: "PBES2-HS512+A256KW", enc: "A256GCM" })
        .setIssuedAt();

      if (expires) {
        encoded.setExpirationTime(expires.getTime());
      }

      encoded = encoded.encrypt(new TextEncoder().encode(secret));
    } else if (sign && secret) {
      encoded = new SignJWT({ data })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt();

      if (expires) {
        encoded.setExpirationTime(expires.getTime());
      }

      encoded = encoded.sign(new TextEncoder().encode(secret));
    } else {
      encoded = new UnsecuredJWT({ data }).setIssuedAt().encode();
    }

    return encoded as string;
  }

  async function decodeJWT(jwt: string) {
    if (encrypt && secret) {
      try {
        let { payload: unsignedValue } = await jwtDecrypt(
          jwt,
          new TextEncoder().encode(secret)
        );
        return unsignedValue.data as SessionData;
      } catch {}

      return null;
    } else if (sign && secret) {
      try {
        let { payload: unsignedValue } = await jwtVerify(
          jwt,
          new TextEncoder().encode(secret)
        );

        return unsignedValue.data as SessionData;
      } catch {}

      return null;
    }

    return UnsecuredJWT.decode(jwt).payload.data as SessionData;
  }

  return {
    async getSession(
      cookieHeader?: string | null,
      options?: CookieOptions
    ): Promise<Session> {
      let cookies =
        cookieHeader && parse(cookieHeader, { ...options, ...cookie });
      let jwt = cookies && cookies[cookie.name] ? cookies[cookie.name] : "";
      let data: SessionData | null = {};
      let id = "";

      try {
        data = await decodeJWT(jwt);
        id = jwt.split(".").slice(-1)[0] + "";
      } catch {
        data = {};
        id = "";
      }

      return createSession(data || {}, id);
    },

    async getJWT(
      cookieHeader?: string | null,
      options?: CookieOptions
    ): Promise<string | null> {
      let cookies =
        cookieHeader && parse(cookieHeader, { ...options, ...cookie });
      let jwt = cookies && cookies[cookie.name] ? cookies[cookie.name] : "";

      try {
        await decodeJWT(jwt);

        return jwt;
      } catch {
        return null;
      }
    },

    async commitSession(
      session: Session,
      options?: CookieOptions
    ): Promise<string> {
      let jwt = await encodeJWT(
        session.data,
        options?.expires || new Date(Date.now() + (cookie.maxAge || 0) * 1000)
      );

      let serializedCookie = serialize(cookie.name, jwt, {
        ...options,
        ...cookie,
      });

      if (serializedCookie.length > 4096) {
        throw new Error(
          "Cookie length will exceed browser maximum. Length: " +
            serializedCookie.length
        );
      }

      return serializedCookie;
    },

    destroySession(_: Session, options?: CookieOptions): Promise<string> {
      return Promise.resolve(
        serialize(cookie.name, "", {
          ...(options || cookie),
          expires: new Date(0),
        })
      );
    },
  };
}