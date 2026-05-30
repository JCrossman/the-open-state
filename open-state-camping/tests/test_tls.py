"""Tests for shared TLS trust configuration (offline).

Verify that outbound HTTPS honors an operator-provided CA bundle (the corporate
or proxy case) and otherwise falls back to a system/certifi SSL context, without
ever disabling verification.
"""

from __future__ import annotations

import ssl

from open_state_camping.tls import verify_setting


def test_uses_requests_ca_bundle_when_present(tmp_path, monkeypatch):
    bundle = tmp_path / "corp-ca.crt"
    bundle.write_text("dummy")
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(bundle))
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    assert verify_setting() == str(bundle)


def test_uses_ssl_cert_file_when_no_requests_bundle(tmp_path, monkeypatch):
    bundle = tmp_path / "proxy-ca.crt"
    bundle.write_text("dummy")
    monkeypatch.delenv("REQUESTS_CA_BUNDLE", raising=False)
    monkeypatch.setenv("SSL_CERT_FILE", str(bundle))
    assert verify_setting() == str(bundle)


def test_falls_back_to_context_when_unset(monkeypatch):
    monkeypatch.delenv("REQUESTS_CA_BUNDLE", raising=False)
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    assert isinstance(verify_setting(), ssl.SSLContext)


def test_ignores_nonexistent_bundle_path(monkeypatch):
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", "/no/such/ca-bundle.crt")
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    # A bad path must not be passed through; fall back to a real context instead.
    assert isinstance(verify_setting(), ssl.SSLContext)
