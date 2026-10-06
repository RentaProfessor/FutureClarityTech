/* PlantWatch: a minimal Supabase client (Auth, PostgREST, Edge Functions) over fetch.
 *
 * Session handling rule: the user is only signed out when Supabase rejects the
 * refresh token. Network failures and 5xx responses during a token refresh keep
 * the session, so a phone that is briefly offline does not land on the login
 * screen. */
(function () {
  "use strict";
  const PW = (window.PW = window.PW || {});

  const SESSION_KEY = "pw-session";
  const REFRESH_MARGIN_S = 60;

  /** The session is gone (refresh token rejected or signed out). */
  class AuthError extends Error {}
  /** The server could not be reached or failed; worth retrying later. */
  class NetworkError extends Error {}
  PW.AuthError = AuthError;
  PW.NetworkError = NetworkError;

  PW.createSupabase = function createSupabase(cfg) {
    const base = String(cfg.supabaseUrl).replace(/\/+$/, "");
    const anonKey = cfg.supabaseAnonKey;
    const signedOutListeners = new Set();
    let session = readSession();
    let refreshing = null;

    function readSession() {
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      } catch {
        return null;
      }
    }

    function saveSession(next) {
      session = next;
      try {
        if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        else localStorage.removeItem(SESSION_KEY);
      } catch {
        // Storage unavailable (private mode): the session lives in memory only.
      }
    }

    function endSession() {
      if (!session) return;
      saveSession(null);
      signedOutListeners.forEach((fn) => fn());
    }

    async function gotrue(path, body, token) {
      let response;
      try {
        response = await fetch(`${base}/auth/v1/${path}`, {
          method: "POST",
          headers: {
            apikey: anonKey,
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body || {}),
        });
      } catch {
        throw new NetworkError("Can't reach the server. Check your connection.");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.error_description || data.msg || data.message || data.error ||
          `Request failed (${response.status})`;
        if (response.status >= 500 || response.status === 429) {
          throw new NetworkError(
            `The server is unavailable (${response.status}). Try again shortly.`,
          );
        }
        throw new AuthError(message);
      }
      return data;
    }

    function withExpiry(data) {
      if (!data.expires_at && data.expires_in) {
        data.expires_at = Math.floor(Date.now() / 1000) + data.expires_in;
      }
      return data;
    }

    /** Refreshes the access token once, even if several callers ask at the same time. */
    function refresh() {
      if (!session || !session.refresh_token) return Promise.reject(new AuthError("Signed out"));
      if (!refreshing) {
        refreshing = gotrue("token?grant_type=refresh_token", {
          refresh_token: session.refresh_token,
        })
          .then((data) => saveSession(withExpiry(data)))
          .catch((err) => {
            if (err instanceof AuthError) endSession();
            throw err;
          })
          .finally(() => {
            refreshing = null;
          });
      }
      return refreshing;
    }

    /** A usable access token. Throws AuthError when signed out, NetworkError when offline. */
    async function accessToken() {
      if (!session) throw new AuthError("Signed out");
      const now = Date.now() / 1000;
      const expiresAt = session.expires_at || 0;
      if (now < expiresAt - REFRESH_MARGIN_S) return session.access_token;
      try {
        await refresh();
      } catch (err) {
        // Offline but the current token still has a little life left: use it.
        if (err instanceof NetworkError && now < expiresAt) return session.access_token;
        throw err;
      }
      return session.access_token;
    }

    async function authedFetch(url, init, retried) {
      const token = await accessToken();
      let response;
      try {
        response = await fetch(url, {
          ...init,
          headers: { apikey: anonKey, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
        });
      } catch {
        throw new NetworkError("Can't reach the server. Check your connection.");
      }
      if (response.status === 401 && !retried) {
        // The token may have been revoked or expired early: refresh once and retry.
        await refresh();
        return authedFetch(url, init, true);
      }
      if (response.status === 401) {
        endSession();
        throw new AuthError("Your session has expired. Please sign in again.");
      }
      return response;
    }

    async function readJson(response) {
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return { message: text.slice(0, 200) };
      }
    }

    function errorMessage(data, status) {
      return (data && (data.error || data.message || data.msg)) || `Request failed (${status})`;
    }

    return {
      hasSession: () => Boolean(session),
      userId: () => (session && session.user ? session.user.id : null),
      email: () => (session && session.user ? session.user.email : null),
      onSignedOut(fn) {
        signedOutListeners.add(fn);
      },

      async signIn(email, password) {
        saveSession(withExpiry(await gotrue("token?grant_type=password", { email, password })));
      },

      /** Returns false when Supabase requires email confirmation before the first sign-in. */
      async signUp(email, password) {
        const data = await gotrue("signup", { email, password });
        if (!data.access_token) return false;
        saveSession(withExpiry(data));
        return true;
      },

      async signOut() {
        const token = session && session.access_token;
        // Revoke the refresh token server-side; sign out locally either way.
        if (token) await gotrue("logout", {}, token).catch(() => {});
        endSession();
      },

      /** PostgREST request with the user's token, so row-level security applies. */
      async rest(path, { method = "GET", body, prefer } = {}) {
        const headers = { "Content-Type": "application/json" };
        if (prefer) headers.Prefer = prefer;
        const response = await authedFetch(`${base}/rest/v1/${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }, false);
        const data = await readJson(response);
        if (!response.ok) {
          const err = new Error(errorMessage(data, response.status));
          if (response.status >= 500) throw new NetworkError(err.message);
          throw err;
        }
        return data;
      },

      rpc(fn, args) {
        return this.rest(`rpc/${fn}`, { method: "POST", body: args || {} });
      },

      /** Calls an Edge Function; resolves to the parsed JSON body or throws. */
      async invoke(name, { method = "GET", body } = {}) {
        const response = await authedFetch(`${base}/functions/v1/${name}`, {
          method,
          headers: body === undefined ? {} : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }, false);
        const data = await readJson(response);
        if (!response.ok) {
          const message = errorMessage(data, response.status);
          throw response.status >= 500 ? new NetworkError(message) : new Error(message);
        }
        return data;
      },
    };
  };
})();
