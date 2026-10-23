#!/usr/bin/env python3
"""Check explicit table ACL decisions at CREATE time, without touching a database.

This is a migration-source guard, not an effective-privilege or RLS test. Run the
SQL assertions after a real migration replay as documented in docs/qa.
"""

import argparse
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "security/data-api-grant-inventory.json"
IDENT = r'(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z_0-9$]*)'
RELATION = rf'(?:{IDENT}\s*\.\s*)?{IDENT}'


def statements(sql):
    """Split top-level SQL; ignore comments and preserve quoted/dollar strings."""
    result, current, i = [], [], 0
    while i < len(sql):
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            i = len(sql) if end < 0 else end
            current.append(" ")
        elif sql.startswith("/*", i):
            depth, i = 1, i + 2
            while i < len(sql) and depth:
                if sql.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif sql.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            if depth:
                raise ValueError("unterminated block comment")
            current.append(" ")
        elif sql[i] in "'\"":
            quote, start = sql[i], i
            i += 1
            while i < len(sql):
                if sql[i] == quote:
                    i += 1
                    if i < len(sql) and sql[i] == quote:
                        i += 1
                        continue
                    break
                i += 1
            else:
                raise ValueError("unterminated quoted string")
            current.append(sql[start:i])
        elif sql[i] == "$" and (match := re.match(r'\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$', sql[i:])):
            delimiter = match.group()
            end = sql.find(delimiter, i + len(delimiter))
            if end < 0:
                raise ValueError("unterminated dollar string")
            current.append(sql[i:end + len(delimiter)])
            i = end + len(delimiter)
        elif sql[i] == ";":
            result.append("".join(current).strip())
            current, i = [], i + 1
        else:
            current.append(sql[i])
            i += 1
    if "".join(current).strip():
        result.append("".join(current).strip())
    return result


def relation(name):
    parts = [p.strip().strip('"') for p in name.split(".")]
    return ".".join(parts if len(parts) == 2 else ["public", parts[0]])


def collect(directory):
    migrations = sorted(directory.glob("*.sql"))
    tables, errors, drops = [], [], []
    for path in migrations:
        sql = statements(path.read_text())
        acl = []
        rls = set()
        for stmt in sql:
            if match := re.match(rf'ALTER\s+TABLE\s+({RELATION})\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*$', stmt, re.I):
                rls.add(relation(match[1]))
            if match := re.match(rf'DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?({RELATION})\b', stmt, re.I):
                drops.append({"table": relation(match[1]), "migration": path.name})
            if match := re.match(r'(GRANT|REVOKE)\s+(.+?)\s+ON\s+(?:TABLE\s+)?(.+?)\s+(TO|FROM)\s+(.+)$', stmt, re.I | re.S):
                if not re.match(r'^(FUNCTION|SEQUENCE|SCHEMA|TYPE|PROCEDURE|ALL)\b', match[3], re.I):
                    targets = [relation(t.strip()) for t in match[3].split(",")]
                    acl.append((targets, " ".join(stmt.split())))
        for stmt in sql:
            if not re.match(r'CREATE\s+TABLE\b', stmt, re.I) and re.search(r'\bCREATE\s+(?:UNLOGGED\s+)?TABLE\b', stmt, re.I):
                errors.append(f"{path.name}: nested/quoted CREATE TABLE requires explicit manual guard support")
            match = re.match(rf'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?({RELATION})\s*\(', stmt, re.I)
            if not match:
                # A new CREATE TABLE AS/LIKE form must receive manual coverage.
                if re.match(r'CREATE\s+(?:UNLOGGED\s+)?TABLE\b', stmt, re.I):
                    errors.append(f"{path.name}: unsupported CREATE TABLE syntax")
                continue
            table = relation(match[1])
            if not table.startswith("public."):
                continue
            decisions = [s for targets, s in acl if table in targets]
            if not decisions:
                errors.append(f"{path.name}: {table} has no explicit same-migration GRANT/REVOKE")
            if table not in rls:
                errors.append(f"{path.name}: {table} has no same-migration ENABLE ROW LEVEL SECURITY")
            tables.append({"table": table, "created_in": path.name, "rls_enabled_at_creation": table in rls, "creation_acl": decisions})
    return {"scope": "Top-level public CREATE TABLE statements; creation ACL, not final effective privileges", "migration_count": len(migrations), "tables": tables, "dropped_tables": drops}, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-inventory", action="store_true", help="refresh reviewed source inventory")
    args = parser.parse_args()
    inventory, errors = collect(ROOT / "supabase/migrations")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    if args.write_inventory:
        INVENTORY.write_text(json.dumps(inventory, indent=2) + "\n")
    elif not INVENTORY.exists() or json.loads(INVENTORY.read_text()) != inventory:
        print("Migration ACL inventory changed; review table grants/RLS and refresh the inventory.", file=sys.stderr)
        return 1
    print(f"PASS: {inventory['migration_count']} migrations; {len(inventory['tables'])} public table creations have explicit ACL and RLS decisions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
