/**
 * Copyright (c) 2026 ООО «НГ-ЭНЕРГОСЕРВИС». Все права защищены.
 * Программный комплекс «Честная Генерация»
 * Модуль веб-дашборда и визуализации телеметрии
 * Автор: Саввиди Александр Анатольевич | ИНН 4725009270
 *
 * Данное программное обеспечение является конфиденциальным.
 * Несанкционированное копирование, распространение или использование
 * без письменного разрешения правообладателя запрещено.
 */

const path = require("path");
const { spawn } = require("child_process");
const backendDir = path.join(__dirname, "..", "backend");
const child = spawn(
  path.join(backendDir, ".venv", "Scripts", "python.exe"),
  ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5555", "--reload"],
  { stdio: "inherit", cwd: backendDir }
);
child.on("exit", (code) => process.exit(code || 0));
