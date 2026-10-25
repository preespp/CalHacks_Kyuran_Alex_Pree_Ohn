"""Deployment routing and packaging must preserve API auth and exclude local data."""

import importlib.util
from pathlib import Path
import shutil
import zipfile

from fastapi.testclient import TestClient
import pytest

from commonplace_api.config import Settings
from commonplace_api import main

ROOT = Path(__file__).resolve().parents[3]


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def deployment(tmp_path, monkeypatch):
    root = tmp_path / "deployment"
    root.mkdir()
    shutil.copyfile(ROOT / "app_service.py", root / "app_service.py")
    dist = root / "apps" / "web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Remi deployment test</title>")
    (dist / "assets" / "app.js").write_text("console.log('frontend asset');")
    (root / ".env").write_text("DECOY=must-not-be-served")
    (dist / ".env").write_text("DECOY=also-must-not-be-served")
    monkeypatch.setattr(main, "app", main.create_app(Settings(
        data_dir=tmp_path / "data", app_env="prototype", guest_profile_store="local",
    )))
    entry = load_module(root / "app_service.py", "entry_test")
    with TestClient(entry.app) as client:
        yield client


@pytest.mark.parametrize("path", ["/", "/index.html", "/camera", "/?view=assistant", "/muse"])
def test_frontend_page_routes(deployment, path):
    response = deployment.get(path)
    assert response.status_code == 200
    assert "Remi deployment test" in response.text
    assert response.headers["cache-control"] == "no-store"


def test_frontend_asset(deployment):
    response = deployment.get("/assets/app.js")
    assert response.status_code == 200
    assert "javascript" in response.headers["content-type"]
    assert "frontend asset" in response.text


@pytest.mark.parametrize("path", [
    "/api", "/api/missing", "/assets/missing.js", "/assets/missing",
    "/missing.js", "/.env", "/assets/%2e%2e/%2eenv",
])
def test_missing_api_assets_and_private_files_never_return_frontend_html(deployment, path):
    response = deployment.get(path)
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert "must-not-be-served" not in response.text


def test_deployment_keeps_real_guest_flow_and_api_authorization(deployment):
    assert deployment.get("/api/health").status_code == 200
    assert deployment.get("/api/objects").status_code == 401
    response = deployment.post("/api/guest/session", json={"name": "Azure tester"})
    assert response.status_code == 200
    token = response.json()["token"]
    response = deployment.get("/api/objects", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"objects": []}


def test_missing_frontend_build_has_an_actionable_error(tmp_path):
    path = tmp_path / "app_service.py"
    shutil.copyfile(ROOT / "app_service.py", path)
    with pytest.raises(RuntimeError, match="npm run build"):
        load_module(path, "missing_build_test")


@pytest.fixture
def packaging(tmp_path):
    packager = load_module(ROOT / "deploy/azure/package.py", "packager_test")
    root = tmp_path / "source"
    for name in packager.REQUIRED_FILES:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("required file")
    for directory in packager.SOURCE_DIRECTORIES:
        source = root / directory
        source.mkdir(parents=True, exist_ok=True)
        (source / "__init__.py").write_text("")
        (source / "pipeline.py").write_text("# application code")
        (source / "test_local.py").write_text("# excluded tests")
    dist = root / "apps/web/dist"
    (dist / "assets").mkdir()
    (dist / "assets/app.js").write_text("// compiled frontend")
    return packager, root, tmp_path / "release.zip"


def test_zip_has_installable_monorepo_paths_and_excludes_secrets_and_local_state(packaging):
    packager, root, output = packaging
    for name in [".env", ".data/memory.sqlite3", ".venv/private.py", "apps/web/dist/.env", "deploy/azure/appsettings.local.json"]:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("DECOY=private-local-data")
    (root / "apps/web/dist/memory.sqlite3").write_text("DECOY=database")
    packager.package_project(root, output)
    with zipfile.ZipFile(output) as archive:
        names = set(archive.namelist())
        assert set(packager.REQUIRED_FILES) <= names
        assert "apps/web/dist/assets/app.js" in names
        assert "services/worker/pipeline.py" in names
        assert "services/api/commonplace_api/__init__.py" in names
        assert not any(".env" in name or "sqlite" in name or "test_local" in name or "appsettings" in name for name in names)
        assert all(b"DECOY=" not in archive.read(name) for name in names)


def test_missing_build_prevents_creating_a_broken_zip(packaging):
    packager, root, output = packaging
    (root / "apps/web/dist/index.html").unlink()
    with pytest.raises(ValueError, match="npm run build"):
        packager.package_project(root, output)
    assert not output.exists()


def test_packaging_rejects_links_to_files_outside_the_repository(packaging, tmp_path):
    packager, root, output = packaging
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    (root / "apps/web/dist/assets/leak.js").symlink_to(outside)
    with pytest.raises(ValueError, match="regular files inside the project"):
        packager.package_project(root, output)
    assert not output.exists()
