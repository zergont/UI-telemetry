const path = require("path");
const { spawn } = require("child_process");
const backendDir = path.join(__dirname, "..", "backend");
const child = spawn(
  path.join(backendDir, ".venv", "Scripts", "python.exe"),
  ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5555", "--reload"],
  { stdio: "inherit", cwd: backendDir }
);
child.on("exit", (code) => process.exit(code || 0));
