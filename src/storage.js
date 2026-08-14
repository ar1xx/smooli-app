const BASE = "/api";

function getToken() {
  try {
    const raw = window.sessionStorage.getItem("smooli:session");
    if (raw) return JSON.parse(raw)?.token;
  } catch {}
  return null;
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function sget(key, shared = false) {
  try {
    const res = await fetch(`${BASE}/kv/${encodeURIComponent(key)}?shared=${shared}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
  }
}

export async function sset(key, value, shared = false) {
  try {
    await fetch(`${BASE}/kv/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ value, shared }),
    });
  } catch (e) {
    console.error("storage set failed", key, e);
  }
}

export async function authRegister(nickname, password) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password }),
  });
  return res.ok;
}

export async function authLogin(nickname, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data;
}

export async function authLogout() {
  const res = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: authHeaders(),
  });
  return res.ok;
}

export async function getUser(nickname) {
  try {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(nickname)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
