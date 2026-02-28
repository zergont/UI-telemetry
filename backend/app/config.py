from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

# Версия из кода — обновляется через git pull (config.yaml НЕ в git!)
APP_VERSION = "1.0.3"


class AppConfig(BaseModel):
    name: str = "Честная Генерация"
    version: str = APP_VERSION
    debug: bool = False


class AuthConfig(BaseModel):
    token: str


class DatabaseConfig(BaseModel):
    host: str = "localhost"
    port: int = 5432
    name: str = "cg"
    admin_user: str = "cg_writer"
    admin_password: str = ""
    ui_user: str = "cg_ui"
    ui_password: str = ""
    pool_min: int = 2
    pool_max: int = 10


class MqttConfig(BaseModel):
    host: str = "localhost"
    port: int = 1883
    topic_prefix: str = "cg/v1/decoded/SN"
    client_id: str = "cg-dashboard"
    reconnect_interval: int = 5
    max_reconnect_interval: int = 60


class MapConfig(BaseModel):
    style_url: str = "https://demotiles.maplibre.org/style.json"
    center: list[float] = [100.0, 62.0]
    zoom: int = 3


class FrontendConfig(BaseModel):
    dev_port: int = 5173
    api_base_url: str = "http://localhost:5555"
    ws_url: str = "ws://localhost:5555/ws"
    map: MapConfig = MapConfig()


class BackendConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 5555


class KeyRegisters(BaseModel):
    installed_power: int = 43019
    current_load: int = 40034
    engine_hours: int = 40070
    oil_temp: int = 40063
    oil_pressure: int = 40062
    engine_state: int = 46109


class TelemetryConfig(BaseModel):
    offline_timeout_sec: int = 300
    key_registers: KeyRegisters = KeyRegisters()


class AccessConfig(BaseModel):
    lan_subnets: list[str] = ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12", "127.0.0.0/8"]
    public_base_url: str = "https://localhost:9443"
    session_secret: str = "CHANGE-ME"
    session_max_age_sec: int = 86400
    share_default_expire_days: int = 7
    trusted_proxy_ips: list[str] = ["127.0.0.1"]


class Settings(BaseModel):
    app: AppConfig = AppConfig()
    auth: AuthConfig
    database: DatabaseConfig = DatabaseConfig()
    mqtt: MqttConfig = MqttConfig()
    backend: BackendConfig = BackendConfig()
    frontend: FrontendConfig = FrontendConfig()
    telemetry: TelemetryConfig = TelemetryConfig()
    access: AccessConfig = AccessConfig()


def _find_config_path() -> Path:
    env = os.environ.get("CG_CONFIG_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "config.yaml"


@lru_cache
def get_settings() -> Settings:
    path = _find_config_path()
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return Settings(**data)
