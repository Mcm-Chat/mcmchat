"""Server-only QA helpers for the three-device E2E run.

Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment.
Never import this from client/browser code and never print key material.
"""
import json, os, time, urllib.request, urllib.error, urllib.parse

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def _req(method, path, body=None, headers=None, base=None):
    h = dict(H)
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request((base or URL) + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def create_user(email, password):
    s, b = _req("POST", "/auth/v1/admin/users", {"email": email, "password": password, "email_confirm": True})
    assert s in (200, 201), (s, b)
    return b["id"]


def delete_user(uid):
    return _req("DELETE", f"/auth/v1/admin/users/{uid}")[0]


def rest(method, table, query="", body=None, prefer=None):
    h = {"Prefer": prefer} if prefer else None
    return _req(method, f"/rest/v1/{table}{query}", body, h)


def select(table, query):
    s, b = rest("GET", table, query)
    assert s == 200, (s, b)
    return b


def rpc(name, args=None):
    return _req("POST", f"/rest/v1/rpc/{name}", args or {})


def sign_in(email, password):
    """Anon-key sign-in used only to script API-level RLS probes."""
    anon = os.environ["SUPABASE_PUBLISHABLE_KEY"]
    req = urllib.request.Request(
        URL + "/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())["access_token"]


def as_user(token, method, path, body=None, prefer=None):
    anon = os.environ["SUPABASE_PUBLISHABLE_KEY"]
    h = {"apikey": anon, "Authorization": "Bearer " + token, "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
