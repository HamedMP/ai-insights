import { rmSync } from "node:fs";

// Compiled UI scripts are rebuilt from ui/src on every build, so a deleted module cannot linger in the app.
rmSync(new URL("../ui/static/js", import.meta.url), { recursive: true, force: true });
