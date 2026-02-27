#!/usr/bin/env bash
# =============================================================
# Честная Генерация — Установка на Ubuntu 24.04
# =============================================================
#
# Запуск:
#   sudo bash deploy/install.sh
#
# Что делает:
#   1. Устанавливает системные пакеты (Python 3, Node.js 20, nginx, git)
#   2. Создаёт пользователя cg и директорию /opt/cg-dashboard
#   3. Настраивает Python venv и pip install
#   4. Собирает фронтенд (npm install + npm run build)
#   5. Генерирует self-signed TLS сертификат
#   6. Устанавливает systemd сервис
#   7. Устанавливает nginx конфиг
#   8. Настраивает sudoers для auto-update
# =============================================================

set -euo pipefail

# ── Цвета ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Проверка root ──
[[ $EUID -eq 0 ]] || error "Запустите с sudo: sudo bash deploy/install.sh"

# ── Определяем откуда запускаем ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_SRC="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="/opt/cg-dashboard"
CG_USER="cg"

info "Источник: $PROJECT_SRC"
info "Установка в: $INSTALL_DIR"

# =============================================================
# 1. Системные пакеты
# =============================================================
info "Устанавливаем системные пакеты..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-venv python3-pip \
    nginx git curl \
    > /dev/null

# Node.js 20 (если нет)
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
    info "Устанавливаем Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null
fi

info "Python: $(python3 --version)"
info "Node:   $(node --version)"
info "npm:    $(npm --version)"

# =============================================================
# 2. Пользователь и директория
# =============================================================
if ! id -u "$CG_USER" &>/dev/null; then
    info "Создаём пользователя $CG_USER..."
    useradd -r -s /bin/bash -m -d /home/$CG_USER $CG_USER
fi

if [[ -d "$INSTALL_DIR" ]]; then
    info "Директория $INSTALL_DIR уже существует — обновляем..."
else
    info "Создаём $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
fi

# =============================================================
# 3. Копируем файлы (или используем git clone)
# =============================================================
if [[ -d "$PROJECT_SRC/.git" ]]; then
    # Если запускаем из git-репозитория — настраиваем git в INSTALL_DIR
    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        info "Клонируем репозиторий..."
        REMOTE_URL=$(git -C "$PROJECT_SRC" remote get-url origin 2>/dev/null || echo "")
        if [[ -n "$REMOTE_URL" ]]; then
            git clone "$REMOTE_URL" "$INSTALL_DIR.tmp"
            # Сохраняем config.yaml если уже есть
            [[ -f "$INSTALL_DIR/config.yaml" ]] && cp "$INSTALL_DIR/config.yaml" /tmp/cg-config-backup.yaml
            rm -rf "$INSTALL_DIR"
            mv "$INSTALL_DIR.tmp" "$INSTALL_DIR"
            [[ -f /tmp/cg-config-backup.yaml ]] && mv /tmp/cg-config-backup.yaml "$INSTALL_DIR/config.yaml"
        else
            info "Нет remote — копируем файлы напрямую..."
            rsync -a --exclude='.venv' --exclude='node_modules' --exclude='dist' \
                  --exclude='__pycache__' --exclude='.claude' \
                  "$PROJECT_SRC/" "$INSTALL_DIR/"
        fi
    else
        info "Git-репозиторий уже есть в $INSTALL_DIR"
        git -C "$INSTALL_DIR" pull origin master || warn "git pull не удался"
    fi
else
    info "Копируем файлы..."
    rsync -a --exclude='.venv' --exclude='node_modules' --exclude='dist' \
          --exclude='__pycache__' --exclude='.claude' \
          "$PROJECT_SRC/" "$INSTALL_DIR/"
fi

# =============================================================
# 4. Конфигурация
# =============================================================
if [[ ! -f "$INSTALL_DIR/config.yaml" ]]; then
    info "Создаём config.yaml из шаблона..."
    cp "$INSTALL_DIR/config.yaml.example" "$INSTALL_DIR/config.yaml"
    warn "ВАЖНО: отредактируйте /opt/cg-dashboard/config.yaml!"
    warn "  - database.host = localhost (PostgreSQL на этом же сервере)"
    warn "  - database.admin_password, ui_password"
    warn "  - mqtt.host = localhost"
    warn "  - auth.token = случайная строка"
    warn "  - access.session_secret = случайная строка"
    warn "  - access.public_base_url = ваш URL"
else
    info "config.yaml уже существует"
fi

# =============================================================
# 5. Python venv + зависимости бэкенда
# =============================================================
info "Настраиваем Python venv..."
cd "$INSTALL_DIR/backend"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt -q
info "Python-зависимости установлены"

# =============================================================
# 6. Фронтенд: npm install + build
# =============================================================
info "Собираем фронтенд..."
cd "$INSTALL_DIR/frontend"
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null
info "Фронтенд собран → frontend/dist/"

# =============================================================
# 7. Self-signed TLS сертификат
# =============================================================
SSL_DIR="/etc/ssl/cg-dashboard"
if [[ ! -f "$SSL_DIR/cg-selfsigned.crt" ]]; then
    info "Генерируем self-signed TLS сертификат..."
    mkdir -p "$SSL_DIR"
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$SSL_DIR/cg-selfsigned.key" \
        -out "$SSL_DIR/cg-selfsigned.crt" \
        -subj "/CN=cg-dashboard/O=CG/C=RU" \
        2>/dev/null
    chmod 600 "$SSL_DIR/cg-selfsigned.key"
    info "Сертификат: $SSL_DIR/cg-selfsigned.crt"
else
    info "TLS сертификат уже существует"
fi

# =============================================================
# 8. Права на файлы
# =============================================================
info "Настраиваем права..."
chown -R $CG_USER:$CG_USER "$INSTALL_DIR"
# Git safe directory
su - $CG_USER -c "git config --global --add safe.directory $INSTALL_DIR" 2>/dev/null || true

# =============================================================
# 9. Systemd сервис
# =============================================================
info "Устанавливаем systemd сервис..."
cp "$INSTALL_DIR/deploy/cg-dashboard.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable cg-dashboard
info "Сервис cg-dashboard установлен и включён"

# =============================================================
# 10. Sudoers для auto-update (cg может restart без пароля)
# =============================================================
SUDOERS_FILE="/etc/sudoers.d/cg-dashboard"
if [[ ! -f "$SUDOERS_FILE" ]]; then
    info "Настраиваем sudoers для auto-update..."
    echo "$CG_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart cg-dashboard" > "$SUDOERS_FILE"
    chmod 440 "$SUDOERS_FILE"
    info "Пользователь $CG_USER может делать systemctl restart cg-dashboard"
fi

# =============================================================
# 11. Nginx
# =============================================================
info "Настраиваем nginx..."
cp "$INSTALL_DIR/deploy/cg-dashboard-nginx.conf" /etc/nginx/sites-available/cg-dashboard
ln -sf /etc/nginx/sites-available/cg-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

if nginx -t 2>/dev/null; then
    systemctl reload nginx
    info "nginx настроен и перезагружен"
else
    warn "nginx -t завершился с ошибкой! Проверьте конфигурацию вручную"
    nginx -t
fi

# =============================================================
# Готово!
# =============================================================
echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Установка завершена!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "  Следующие шаги:"
echo ""
echo "  1. Отредактируйте конфиг:"
echo "     sudo nano /opt/cg-dashboard/config.yaml"
echo ""
echo "  2. Запустите сервис:"
echo "     sudo systemctl start cg-dashboard"
echo ""
echo "  3. Проверьте статус:"
echo "     sudo systemctl status cg-dashboard"
echo "     curl http://localhost:5555/api/health"
echo ""
echo "  4. Откройте в браузере:"
echo "     https://$(hostname -I | awk '{print $1}'):9443"
echo ""
echo "  5. Логи:"
echo "     sudo journalctl -u cg-dashboard -f"
echo ""
