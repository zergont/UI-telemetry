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
const frontendDir = path.join(__dirname, "..", "frontend");
const child = spawn(
  process.execPath,
  [path.join(frontendDir, "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--host"],
  { stdio: "inherit", cwd: frontendDir }
);
child.on("exit", (code) => process.exit(code));
