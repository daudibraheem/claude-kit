export { scanProject } from "./scanner.js";
export { buildProjectContext } from "./context-builder.js";
export { packageJsonDetector } from "./package-json.js";
export { tsconfigDetector } from "./tsconfig.js";
export { lockFileDetector } from "./lock-file.js";
export { nodeDetector } from "./node.js";
export { dockerDetector } from "./docker.js";
export { ciDetector } from "./ci.js";
export { pythonDetector } from "./python.js";
export { goDetector } from "./go.js";
export { rustDetector } from "./rust.js";
export { monorepoDetector } from "./monorepo.js";
export { javaDetector } from "./java.js";
export { dotnetDetector } from "./dotnet.js";
export { rubyDetector } from "./ruby.js";

import { packageJsonDetector } from "./package-json.js";
import { tsconfigDetector } from "./tsconfig.js";
import { lockFileDetector } from "./lock-file.js";
import { nodeDetector } from "./node.js";
import { dockerDetector } from "./docker.js";
import { ciDetector } from "./ci.js";
import { pythonDetector } from "./python.js";
import { goDetector } from "./go.js";
import { rustDetector } from "./rust.js";
import { monorepoDetector } from "./monorepo.js";
import { javaDetector } from "./java.js";
import { dotnetDetector } from "./dotnet.js";
import { rubyDetector } from "./ruby.js";
import type { Detector } from "@ccc/core";

export const allDetectors: Detector[] = [
  packageJsonDetector,
  tsconfigDetector,
  lockFileDetector,
  nodeDetector,
  dockerDetector,
  ciDetector,
  pythonDetector,
  goDetector,
  rustDetector,
  monorepoDetector,
  javaDetector,
  dotnetDetector,
  rubyDetector,
];
