"""Regression tests for environment-only demo-account seeding."""

import os

import pytest

from scripts.seed_users import get_seed_users


def test_seed_users_fail_closed_without_a_configured_credential(monkeypatch):
    monkeypatch.delenv("SEED_ADMIN_EMAIL", raising=False)
    with pytest.raises(RuntimeError, match="SEED_ADMIN_EMAIL"):
        get_seed_users(force_pw_change=True)


def test_seed_users_do_not_read_credentials_from_a_source_default():
    source = open(os.path.join(os.path.dirname(__file__), "..", "scripts", "seed_users.py"), encoding="utf-8").read()
    assert "Admin@1234" not in source
    assert "@samarth.gov.in\"" not in source
