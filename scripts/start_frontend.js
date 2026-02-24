const path = require("path");
const { spawn } = require("child_process");
const frontendDir = path.join(__dirname, "..", "frontend");
const child = spawn(
  process.execPath,
  [path.join(frontendDir, "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--host"],
  { stdio: "inherit", cwd: frontendDir }
);
child.on("exit", (code) => process.exit(code));
