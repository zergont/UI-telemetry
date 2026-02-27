"""Контроль версий и auto-update.

Проверяет обновления через git, выполняет git pull + pip install + npm build.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("cg.updater")

# Корень проекта (D:\CloudeCode)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

IS_WINDOWS = sys.platform == "win32"
SERVICE_NAME = "cg-dashboard"


@dataclass
class UpdateState:
    """In-memory singleton состояния обновления."""

    state: str = "idle"  # idle | checking | pulling | installing | building | restarting | done | error
    progress: str = ""
    log: list[str] = field(default_factory=list)
    available: dict | None = None  # {behind_count, commits: [{hash, message}]}
    error: str | None = None


_status = UpdateState()


def get_status() -> UpdateState:
    return _status


def _run(cmd: list[str], cwd: str | Path | None = None, shell: bool = False) -> subprocess.CompletedProcess:
    """Запускает subprocess и возвращает результат."""
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=300,
        shell=shell,
    )


def _log(msg: str) -> None:
    """Добавляет строку в лог обновления."""
    _status.log.append(msg)
    _status.progress = msg
    logger.info(msg)


# ──────────────────────────────────────────────
# Текущая версия
# ──────────────────────────────────────────────

_cached_commit: str | None = None
_cached_branch: str | None = None


def get_current_version(app_version: str = "1.0.0") -> dict:
    """Возвращает текущую версию: config version + git commit + branch."""
    global _cached_commit, _cached_branch

    if _cached_commit is None:
        try:
            r = _run(["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_ROOT)
            _cached_commit = r.stdout.strip() if r.returncode == 0 else "unknown"
        except Exception:
            _cached_commit = "unknown"

    if _cached_branch is None:
        try:
            r = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=PROJECT_ROOT)
            _cached_branch = r.stdout.strip() if r.returncode == 0 else "unknown"
        except Exception:
            _cached_branch = "unknown"

    return {
        "version": app_version,
        "commit": _cached_commit,
        "branch": _cached_branch,
    }


def invalidate_version_cache() -> None:
    """Сбросить кэш версии после обновления."""
    global _cached_commit, _cached_branch
    _cached_commit = None
    _cached_branch = None


# ──────────────────────────────────────────────
# Проверка обновлений
# ──────────────────────────────────────────────

async def check_for_updates() -> dict:
    """Проверяет наличие обновлений на remote."""
    _status.state = "checking"
    _status.error = None

    try:
        # git fetch
        r = await asyncio.to_thread(
            _run, ["git", "fetch", "origin"], cwd=PROJECT_ROOT
        )
        if r.returncode != 0:
            _status.state = "idle"
            return {"up_to_date": True, "error": f"git fetch failed: {r.stderr.strip()}"}

        # Кол-во коммитов позади
        r = await asyncio.to_thread(
            _run, ["git", "rev-list", "--count", "HEAD..origin/master"], cwd=PROJECT_ROOT
        )
        behind_count = int(r.stdout.strip()) if r.returncode == 0 else 0

        commits = []
        if behind_count > 0:
            # Список коммитов
            r = await asyncio.to_thread(
                _run,
                ["git", "log", "--oneline", "HEAD..origin/master", "--format=%h %s"],
                cwd=PROJECT_ROOT,
            )
            if r.returncode == 0:
                for line in r.stdout.strip().split("\n"):
                    if line.strip():
                        parts = line.split(" ", 1)
                        commits.append({
                            "hash": parts[0],
                            "message": parts[1] if len(parts) > 1 else "",
                        })

        result = {
            "up_to_date": behind_count == 0,
            "behind_count": behind_count,
            "commits": commits,
        }
        _status.available = result if behind_count > 0 else None
        _status.state = "idle"
        return result

    except Exception as exc:
        _status.state = "idle"
        _status.error = str(exc)
        return {"up_to_date": True, "error": str(exc)}


# ──────────────────────────────────────────────
# Выполнение обновления
# ──────────────────────────────────────────────

async def perform_update() -> dict:
    """Выполняет полный цикл обновления."""
    if _status.state not in ("idle", "done", "error"):
        return {"ok": False, "error": f"Update already in progress: {_status.state}"}

    _status.state = "pulling"
    _status.log = []
    _status.error = None

    try:
        # 1. Git pull
        _log("git pull origin master...")
        r = await asyncio.to_thread(
            _run, ["git", "pull", "origin", "master"], cwd=PROJECT_ROOT
        )
        _log(f"  exit code: {r.returncode}")
        if r.stdout.strip():
            _log(f"  {r.stdout.strip()}")
        if r.returncode != 0:
            _status.state = "error"
            _status.error = f"git pull failed: {r.stderr.strip()}"
            _log(f"  ERROR: {r.stderr.strip()}")
            return {"ok": False, "error": _status.error}

        # Проверяем, что изменилось
        _log("Checking changed files...")
        r = await asyncio.to_thread(
            _run, ["git", "diff", "--name-only", "HEAD~1..HEAD"], cwd=PROJECT_ROOT
        )
        changed_files = r.stdout.strip().split("\n") if r.returncode == 0 and r.stdout.strip() else []
        _log(f"  Changed: {len(changed_files)} files")

        requirements_changed = any("requirements.txt" in f for f in changed_files)
        frontend_changed = any(f.startswith("frontend/") for f in changed_files)

        # 2. pip install (если requirements.txt изменился)
        if requirements_changed:
            _status.state = "installing"
            _log("pip install -r requirements.txt...")

            pip_exe = str(BACKEND_DIR / ".venv" / ("Scripts" if IS_WINDOWS else "bin") / "pip")
            req_file = str(BACKEND_DIR / "requirements.txt")

            r = await asyncio.to_thread(
                _run, [pip_exe, "install", "-r", req_file], cwd=BACKEND_DIR
            )
            _log(f"  exit code: {r.returncode}")
            if r.returncode != 0:
                _status.state = "error"
                _status.error = f"pip install failed: {r.stderr.strip()[:200]}"
                _log(f"  ERROR: {r.stderr.strip()[:200]}")
                return {"ok": False, "error": _status.error}
        else:
            _log("pip install: skipped (requirements.txt not changed)")

        # 3. npm install + build (если frontend изменился)
        if frontend_changed:
            _status.state = "building"

            _log("npm install...")
            npm_cmd = ["npm", "install"]
            r = await asyncio.to_thread(
                _run, npm_cmd, cwd=FRONTEND_DIR, shell=IS_WINDOWS
            )
            _log(f"  exit code: {r.returncode}")

            if r.returncode == 0:
                _log("npm run build...")
                build_cmd = ["npm", "run", "build"]
                r = await asyncio.to_thread(
                    _run, build_cmd, cwd=FRONTEND_DIR, shell=IS_WINDOWS
                )
                _log(f"  exit code: {r.returncode}")
                if r.returncode != 0:
                    _log(f"  WARNING: build failed: {r.stderr.strip()[:200]}")
            else:
                _log(f"  WARNING: npm install failed: {r.stderr.strip()[:200]}")
        else:
            _log("npm build: skipped (frontend not changed)")

        # 4. Сбросить кэш версии
        invalidate_version_cache()
        _status.available = None

        # 5. Перезапуск
        _status.state = "restarting"
        _log("Restarting backend...")

        if _is_systemd_service():
            _log("Detected systemd, scheduling restart...")
            _status.state = "done"
            _log("Update complete! Restarting via systemctl...")
            # Рестарт через 2 сек — чтобы HTTP-ответ успел уйти клиенту
            loop = asyncio.get_event_loop()
            loop.call_later(2, _systemd_restart)
        else:
            _log("Dev mode: uvicorn --reload picks up changes automatically")
            _status.state = "done"
            _log("Update complete!")

        return {"ok": True}

    except Exception as exc:
        _status.state = "error"
        _status.error = str(exc)
        _log(f"EXCEPTION: {exc}")
        return {"ok": False, "error": str(exc)}


# ──────────────────────────────────────────────
# Systemd helpers
# ──────────────────────────────────────────────

def _is_systemd_service() -> bool:
    """Проверяет, запущен ли процесс как systemd unit."""
    if IS_WINDOWS:
        return False
    # Systemd задаёт переменные INVOCATION_ID / JOURNAL_STREAM
    return bool(os.environ.get("INVOCATION_ID") or os.environ.get("JOURNAL_STREAM"))


def _systemd_restart() -> None:
    """Перезапустить сервис через systemctl (вызывается из call_later)."""
    try:
        logger.info("Executing: systemctl restart %s", SERVICE_NAME)
        subprocess.Popen(
            ["sudo", "systemctl", "restart", SERVICE_NAME],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        logger.error("Failed to restart service: %s", exc)
