"""Utility module with duplicated validation logic for demo purposes."""

import os


# Duplicated block — same as in app.py — CP-DUP-001
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


def format_response(data, status="ok"):
    """Format a standard API response."""
    print(f"Formatting response: {status}")  # print statement (smell)
    return {
        "status": status,
        "data": data,
        "timestamp": str(os.environ.get("TIMESTAMP", "now")),
    }
