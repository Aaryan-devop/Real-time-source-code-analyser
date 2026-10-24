"""Intentionally flawed Flask-style API for CodePulse demo.

This file contains multiple deliberate security issues, code smells,
and complexity problems for demonstration purposes. DO NOT use as a
template for real code!
"""

import os
import pickle
import subprocess
import random
import hashlib
import sqlite3
from flask import Flask, request, jsonify

# Unused imports (smell)
import sys
import json

# Hard-coded password (secret) — CP-SCR-003
DB_PASSWORD = "super_secret_password_123!"
API_KEY = "sk-abc123def456ghi789jkl012mno345"

app = Flask(__name__)

# Debug mode enabled (security) — CP-SEC-014
# Binding to 0.0.0.0 (security) — CP-SEC-015

def connect_db():
    return sqlite3.connect("app.db")


# SQL injection (security) — CP-SEC-010
@app.route("/users/<user_id>")
def get_user(user_id):
    db = connect_db()
    cursor = db.cursor()
    query = f"SELECT * FROM users WHERE id = {user_id}"
    cursor.execute(query)
    return jsonify(cursor.fetchone())


# eval on user input (security) — CP-SEC-001
@app.route("/calculate", methods=["POST"])
def calculate():
    expression = request.json.get("expr")
    result = eval(expression)
    return jsonify({"result": result})


# subprocess with shell=True (security) — CP-SEC-007
@app.route("/ping", methods=["POST"])
def ping_host():
    host = request.json.get("host")
    output = subprocess.check_output(f"ping -c 1 {host}", shell=True)
    return output


# pickle.load (security) — CP-SEC-004
@app.route("/load-session", methods=["POST"])
def load_session():
    data = request.get_data()
    session = pickle.loads(data)
    return jsonify(session)


# Bare except (smell) — CP-SM-002
def process_data(data):
    try:
        return data["key"]["nested"]["value"]
    except:
        return None


# Mutable default argument (smell) — CP-SM-003
def add_item(item, items=[]):
    items.append(item)
    return items


# Very high cyclomatic complexity (>15) — CP-CX-001
def complex_handler(request_type, data, user, config, options, extra, more):
    """This function has intentionally high complexity for demo purposes."""
    result = None
    if request_type == "create":
        if user.is_admin:
            if config.get("strict"):
                if data.get("validated"):
                    result = "created_strict"
                else:
                    result = "validation_required"
            else:
                result = "created"
        elif user.is_moderator:
            if data.get("approved"):
                result = "created_approved"
            else:
                result = "pending"
        else:
            result = "forbidden"
    elif request_type == "update":
        if user.is_admin or user.is_moderator:
            if data.get("id"):
                if options.get("merge"):
                    result = "merged"
                elif options.get("replace"):
                    result = "replaced"
                else:
                    result = "updated"
            else:
                result = "id_required"
        else:
            result = "forbidden"
    elif request_type == "delete":
        if user.is_admin:
            if config.get("soft_delete"):
                result = "soft_deleted"
            else:
                result = "hard_deleted"
        else:
            result = "forbidden"
    elif request_type == "read":
        if data.get("public") or user.is_authenticated:
            result = "data"
        else:
            result = "login_required"
    elif request_type == "export":
        if user.is_admin and config.get("export_enabled"):
            result = "exported"
        else:
            result = "not_available"
    elif request_type == "import":
        if user.is_admin:
            if data.get("format") == "csv":
                result = "imported_csv"
            elif data.get("format") == "json":
                result = "imported_json"
            else:
                result = "unsupported_format"
        else:
            result = "forbidden"
    else:
        result = "unknown_request"

    # Extra complexity
    for item in data.get("items", []):
        if item.get("active"):
            for sub in item.get("children", []):
                if sub.get("valid"):
                    print(f"Processing {sub}")
    
    return result


# Weak hash for security — CP-SEC-011
def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()


# Insecure random — CP-SEC-012
def generate_token():
    return str(random.randint(100000, 999999))


# Unreachable code (smell) — CP-SM-005
def early_return(x):
    if x > 0:
        return x
        print("This is unreachable")
    return -x


# Overly broad except with pass — CP-SM-004
def safe_divide(a, b):
    try:
        return a / b
    except Exception:
        pass


# TODO: Fix this later (smell info) — CP-SM-008
# FIXME: Known bug here
# HACK: This is a temporary workaround


# Duplicated block (will be detected across files) — CP-DUP-001
def validate_user_input(data):
    """Validates user input data with multiple checks."""
    errors = []
    if not data.get("name"):
        errors.append("Name is required")
    if not data.get("email"):
        errors.append("Email is required")
    if data.get("email") and "@" not in data.get("email", ""):
        errors.append("Email must contain @")
    if not data.get("age"):
        errors.append("Age is required")
    if data.get("age") and not isinstance(data.get("age"), int):
        errors.append("Age must be a number")
    if data.get("age") and data.get("age") < 0:
        errors.append("Age must be positive")
    if data.get("age") and data.get("age") > 150:
        errors.append("Age must be realistic")
    return errors


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
