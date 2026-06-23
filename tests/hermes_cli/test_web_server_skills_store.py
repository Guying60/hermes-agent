"""Tests for the desktop Skills Store dashboard endpoints.

Covers the three store-specific routes added for the desktop "Store" tab:
  - GET  /api/skills/store/list     — enumerate the fixed repo's skills
  - GET  /api/skills/store/auth      — GitHub credential precheck for publish
  - POST /api/skills/store/publish   — spawn the publish action

Network (GitHub) and subprocess (publish action) boundaries are mocked so the
tests run offline and never shell out.
"""
import pytest


@pytest.fixture
def client(monkeypatch, _isolate_hermes_home):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    import hermes_state
    from hermes_constants import get_hermes_home
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    (get_hermes_home() / "skills").mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", get_hermes_home() / "state.db")
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


class TestStoreList:
    def test_empty_repo_returns_empty_list(self, client, monkeypatch):
        from tools import skills_hub

        monkeypatch.setattr(
            skills_hub.GitHubSource, "_list_skills_in_repo",
            lambda self, repo, path: [],
        )

        resp = client.get("/api/skills/store/list")
        assert resp.status_code == 200
        body = resp.json()
        assert body["repo"] == skills_hub.FIXED_SKILLS_REPO
        assert body["skills"] == []

    def test_lists_repo_skills_with_payload_shape(self, client, monkeypatch):
        from tools import skills_hub
        from tools.skills_hub import SkillMeta

        meta = SkillMeta(
            name="demo-skill",
            description="A demo skill",
            source="github",
            identifier=f"{skills_hub.FIXED_SKILLS_REPO}/skills/demo-skill",
            trust_level="community",
            repo=skills_hub.FIXED_SKILLS_REPO,
        )
        monkeypatch.setattr(
            skills_hub.GitHubSource, "_list_skills_in_repo",
            lambda self, repo, path: [meta],
        )

        resp = client.get("/api/skills/store/list")
        assert resp.status_code == 200
        skills = resp.json()["skills"]
        assert len(skills) == 1
        entry = skills[0]
        assert entry["name"] == "demo-skill"
        assert entry["identifier"].endswith("skills/demo-skill")
        assert entry["source"] == "github"

    def test_list_surfaces_errors_as_502(self, client, monkeypatch):
        from tools import skills_hub

        def _boom(self, repo, path):
            raise RuntimeError("github down")

        monkeypatch.setattr(skills_hub.GitHubSource, "_list_skills_in_repo", _boom)

        resp = client.get("/api/skills/store/list")
        assert resp.status_code == 502


class TestStoreAuth:
    def test_reports_authenticated(self, client, monkeypatch):
        from tools import skills_hub

        monkeypatch.setattr(skills_hub.GitHubAuth, "is_authenticated", lambda self: True)
        monkeypatch.setattr(skills_hub.GitHubAuth, "auth_method", lambda self: "pat")

        resp = client.get("/api/skills/store/auth")
        assert resp.status_code == 200
        body = resp.json()
        assert body["authenticated"] is True
        assert body["method"] == "pat"

    def test_reports_anonymous(self, client, monkeypatch):
        from tools import skills_hub

        monkeypatch.setattr(skills_hub.GitHubAuth, "is_authenticated", lambda self: False)
        monkeypatch.setattr(skills_hub.GitHubAuth, "auth_method", lambda self: "anonymous")

        resp = client.get("/api/skills/store/auth")
        assert resp.status_code == 200
        assert resp.json()["authenticated"] is False


class TestStorePublish:
    def test_publish_spawns_action(self, client, monkeypatch):
        import hermes_cli.web_server as web_server

        captured = {}

        class _FakeProc:
            pid = 4321

        def _fake_spawn(subcommand, name):
            captured["subcommand"] = list(subcommand)
            captured["name"] = name
            return _FakeProc()

        monkeypatch.setattr(web_server, "_spawn_hermes_action", _fake_spawn)

        resp = client.post("/api/skills/store/publish", json={"name": "demo-skill"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body["name"] == "skills-publish"
        assert body["pid"] == 4321
        assert captured["name"] == "skills-publish"
        assert captured["subcommand"][:2] == ["skills", "store-publish"]
        assert captured["subcommand"][-1] == "demo-skill"

    def test_publish_requires_name(self, client):
        resp = client.post("/api/skills/store/publish", json={"name": "  "})
        assert resp.status_code == 400
