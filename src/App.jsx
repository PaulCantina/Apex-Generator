import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  GitBranch,
  GithubLogo,
  Key,
  Pulse,
  ShieldCheck,
  Timer,
} from "@phosphor-icons/react";
import cantinaLogomark from "./assets/cantina-logomark-color-dark.svg";

const PRIMARY_GRADIENT = "linear-gradient(to right, #E87C40, #CB5626)";
const APEX_BUFFER_WEEKS = 0.2;

const MODE_REDUCTION = {
  conservative: 0.2,
  standard: 0.35,
  strong: 0.5,
};

const MODE_SELECTION_CARDS = [
  {
    key: "conservative",
    title: "Conservative",
    percentLabel: "20%",
    description:
      "Automates initial recon and noise filtering. Catches basic issues so auditors can focus on logic immediately.",
  },
  {
    key: "standard",
    title: "Standard",
    percentLabel: "35%",
    description:
      "The Recommended Balance. Pre-remediates common vulnerability patterns before human review begins.",
  },
  {
    key: "strong",
    title: "Strong",
    percentLabel: "50%",
    description:
      "Full CI/CD Integration. Continuous verification on every PR ensures code arrives at the audit phase clean and verified.",
  },
];

const C_CPP_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hh",
  "hpp",
  "hxx",
  "inc",
  "ipp",
]);

const NON_CODE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "rst",
  "adoc",
  "csv",
  "tsv",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tiff",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "zip",
  "tar",
  "gz",
  "tgz",
  "7z",
  "rar",
  "jar",
  "class",
  "dll",
  "so",
  "dylib",
  "exe",
  "bin",
  "wasm",
  "lock",
]);

const NON_CODE_FILENAMES = new Set([
  "license",
  "copying",
  "notice",
  "readme",
  "changelog",
  "contributing",
  "authors",
  "codeowners",
]);

const ASSEMBLY_PATTERN = /\bassembly\s*\{/;
const UNSAFE_PATTERN = /\bunsafe\s*\{/;
const UPGRADEABILITY_PATTERN =
  /\bdelegatecall\b|\bfallback\b|TransparentUpgradeableProxy|\bUUPS\b/i;
const OPENZEPPELIN_PATTERN = /@openzeppelin/i;
const DEFAULT_TEST_FILE_PATTERN =
  /\.(test|spec)\.[a-z0-9]+$|\.t\.sol$|(^|\/)test[^/]*\.sol$/i;
const DEFAULT_INTERFACE_FILENAME_PATTERN = /^i[A-Z0-9_][^/]*\.sol$/;

const DEFAULT_AUDIT_EXCLUDED_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "mock",
  "mocks",
  "fixture",
  "fixtures",
  "example",
  "examples",
  "script",
  "scripts",
  "benchmark",
  "benchmarks",
  "sample",
  "samples",
  "demo",
  "demos",
]);

const DEFAULT_GENERATED_VENDOR_DIRS = new Set([
  "artifacts",
  "out",
  "build",
  "dist",
  "generated",
  "gen",
  ".generated",
  "cache",
  ".cache",
  "node_modules",
  "vendor",
  "typechain",
  "coverage",
]);

const NON_AUDIT_TOP_LEVEL_KEYWORDS = [
  "doc",
  "docs",
  "example",
  "examples",
  "sample",
  "samples",
  "bench",
  "benchmark",
  "benches",
  "fuzz",
  "fuzzing",
  "playground",
  "tutorial",
  "guide",
  "tool",
  "tools",
  "tooling",
  "script",
  "scripts",
  "deploy",
  "deployment",
  "ops",
  "infra",
  "ci",
  ".github",
  ".gitlab",
  ".circleci",
  ".yarn",
  "frontend",
  "web",
  "ui",
  "dashboard",
  "client",
  "server",
  "monitor",
  "telemetry",
  "debug",
  "debugger",
  "perf",
  "profiling",
  "archive",
  "explorer",
];

const C_STYLE_COMMENT_EXTENSIONS = new Set([
  "sol",
  "rs",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hh",
  "hpp",
  "hxx",
  "inc",
  "ipp",
  "js",
  "jsx",
  "ts",
  "tsx",
  "java",
  "go",
  "cs",
  "swift",
  "kt",
  "kts",
  "dart",
  "css",
  "scss",
]);

const HASH_COMMENT_EXTENSIONS = new Set([
  "py",
  "rb",
  "sh",
  "bash",
  "zsh",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
]);


function createAppError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseGitHubUrl(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw createAppError(
      "input",
      "Please enter a valid GitHub repository URL.",
    );
  }

  if (url.hostname !== "github.com") {
    throw createAppError("input", "Only github.com repository URLs are supported.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw createAppError(
      "input",
      "URL format should be https://github.com/owner/repo.",
    );
  }

  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/i, ""),
  };
}

function getFileExtension(path) {
  const segments = path.toLowerCase().split("/");
  const fileName = segments[segments.length - 1];
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return fileName.slice(dotIndex + 1);
}

function resolveCategory(path) {
  const ext = getFileExtension(path);
  if (ext === "sol") {
    return "solidity";
  }
  if (ext === "rs") {
    return "rust";
  }
  if (C_CPP_EXTENSIONS.has(ext)) {
    return "ccpp";
  }
  return "other";
}

function normalizeScopePath(path) {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\/*/, "")
    .replace(/\/+$/, "");
}

function parseScopePaths(value) {
  return value
    .split(/[,\n]/)
    .map((item) => normalizeScopePath(item))
    .filter(Boolean);
}

function pathMatchesAnyPrefix(path, prefixes) {
  if (!prefixes.length) {
    return false;
  }

  const normalizedPath = normalizeScopePath(path).toLowerCase();
  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizeScopePath(prefix).toLowerCase();
    return (
      normalizedPath === normalizedPrefix ||
      normalizedPath.startsWith(`${normalizedPrefix}/`)
    );
  });
}

function isLikelyNonAuditRoot(segment) {
  const normalized = segment.toLowerCase();
  return NON_AUDIT_TOP_LEVEL_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.includes(keyword),
  );
}

function totalLocFromBreakdown(breakdown) {
  return breakdown.solidity + breakdown.rust + breakdown.ccpp + breakdown.other;
}

function isSolidityInterfaceFile(path, content) {
  if (getFileExtension(path) !== "sol") {
    return false;
  }

  const fileName = path.split("/").pop() || "";
  if (!DEFAULT_INTERFACE_FILENAME_PATTERN.test(fileName)) {
    return false;
  }

  const hasInterface = /\binterface\b/.test(content);
  const hasContractOrLibrary = /\bcontract\b|\blibrary\b/.test(content);
  return hasInterface && !hasContractOrLibrary;
}

function getScopeExclusionReason(path, content, scopeOptions) {
  const {
    includePaths,
    excludePaths,
    useDefaultScopeExclusions,
    smartContractOnly,
  } = scopeOptions;
  const normalizedPath = normalizeScopePath(path);
  const lowerPath = normalizedPath.toLowerCase();
  const segments = lowerPath.split("/");
  const topLevelSegment = segments[0] || "";

  if (includePaths.length && !pathMatchesAnyPrefix(normalizedPath, includePaths)) {
    return "Outside selected include paths";
  }

  if (excludePaths.length && pathMatchesAnyPrefix(normalizedPath, excludePaths)) {
    return "Matched manual exclude path";
  }

  if (!includePaths.length && isLikelyNonAuditRoot(topLevelSegment)) {
    return "Likely non-audit top-level package";
  }

  if (smartContractOnly && resolveCategory(path) === "other") {
    return "Excluded by smart-contract-only mode";
  }

  if (!useDefaultScopeExclusions) {
    return null;
  }

  if (segments.some((segment) => DEFAULT_TEST_FILE_PATTERN.test(segment))) {
    return "Matched test/spec naming pattern";
  }

  if (segments.some((segment) => DEFAULT_AUDIT_EXCLUDED_DIRS.has(segment))) {
    return "In test/mock/script/example directory";
  }

  if (segments.some((segment) => DEFAULT_GENERATED_VENDOR_DIRS.has(segment))) {
    return "In generated/build/vendor directory";
  }

  if (DEFAULT_TEST_FILE_PATTERN.test(lowerPath)) {
    return "Matched test/spec naming pattern";
  }

  if (
    getFileExtension(path) === "sol" &&
    (segments.includes("interfaces") || isSolidityInterfaceFile(path, content))
  ) {
    return "Interface file excluded";
  }

  if (/(^|\/)i[a-z0-9_]+\.sol$/i.test(lowerPath) && /\binterface\b/i.test(content)) {
    return "Interface file excluded";
  }

  return null;
}

function shouldSkipFile(path) {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split("/").pop() || "";
  const ext = getFileExtension(lowerPath);
  if (NON_CODE_EXTENSIONS.has(ext)) {
    return true;
  }
  const withoutExt = fileName.replace(/\.[^.]+$/, "");
  return NON_CODE_FILENAMES.has(withoutExt);
}

function countNonEmptyLines(content) {
  if (!content) {
    return 0;
  }
  let count = 0;
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (line.trim()) {
      count += 1;
    }
  }
  return count;
}

function countCStyleCodeLines(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let inBlockComment = false;
  let count = 0;

  for (const line of lines) {
    let i = 0;
    let hasCode = false;

    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          i = line.length;
          break;
        }
        inBlockComment = false;
        i = end + 2;
        continue;
      }

      const current = line[i];
      const next = line[i + 1];

      if (current === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }

      if (current === "/" && next === "/") {
        break;
      }

      if (!/\s/.test(current)) {
        hasCode = true;
        break;
      }

      i += 1;
    }

    if (hasCode) {
      count += 1;
    }
  }

  return count;
}

function countHashCommentCodeLines(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    count += 1;
  }

  return count;
}

function countEffectiveCodeLines(path, content) {
  const fileExtension = getFileExtension(path);
  if (C_STYLE_COMMENT_EXTENSIONS.has(fileExtension)) {
    return countCStyleCodeLines(content);
  }
  if (HASH_COMMENT_EXTENSIONS.has(fileExtension)) {
    return countHashCommentCodeLines(content);
  }
  return countNonEmptyLines(content);
}

function isLikelyBinary(content) {
  return content.includes("\u0000");
}

function packageJsonUsesOpenZeppelin(content) {
  try {
    const parsed = JSON.parse(content);
    const dependencyKeys = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "resolutions",
    ];

    for (const key of dependencyKeys) {
      const bucket = parsed?.[key];
      if (!bucket || typeof bucket !== "object") {
        continue;
      }
      if (Object.keys(bucket).some((pkg) => pkg.toLowerCase().includes("@openzeppelin"))) {
        return true;
      }
    }
  } catch {
    return OPENZEPPELIN_PATTERN.test(content);
  }

  return false;
}

async function githubRequest(url, token = "") {
  const headers = {
    Accept: "application/vnd.github+json",
  };

  const authToken = token.trim();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    headers,
  });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const rateRemaining = response.headers.get("x-ratelimit-remaining");
    const rateReset = response.headers.get("x-ratelimit-reset");
    const message = payload?.message ?? "";
    const isRateLimit =
      (response.status === 403 && rateRemaining === "0") ||
      /rate limit/i.test(message);

    if (isRateLimit) {
      const resetTime = rateReset
        ? new Date(Number(rateReset) * 1000).toLocaleTimeString()
        : "later";
      throw createAppError(
        "rate_limit",
        `GitHub API rate limit reached. Please try again after ${resetTime}.`,
      );
    }

    if (response.status === 404) {
      throw createAppError(
        "not_found",
        "Repository or branch not found, or repository is not public.",
      );
    }

    if (response.status === 403) {
      throw createAppError(
        "forbidden",
        "GitHub rejected this request. Confirm the repository is public.",
      );
    }

    throw createAppError(
      "api",
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

function decodeBase64Utf8(base64String) {
  const binary = atob(base64String);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function rawGitHubContentUrl(owner, repo, branch, path) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
}

async function fetchBlobContent(owner, repo, branch, file, token) {
  const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file.sha}`;
  const blobData = await githubRequest(blobUrl, token);

  if (blobData.truncated) {
    const rawResponse = await fetch(
      rawGitHubContentUrl(owner, repo, branch, file.path),
    );
    if (!rawResponse.ok) {
      throw createAppError(
        "api",
        `Unable to fetch full content for ${file.path}.`,
      );
    }
    return rawResponse.text();
  }

  if (!blobData.content) {
    return "";
  }

  const normalizedBase64 = blobData.content.replace(/\n/g, "");
  try {
    return decodeBase64Utf8(normalizedBase64);
  } catch {
    return "";
  }
}

async function mapWithConcurrency(items, worker, concurrency = 8) {
  let index = 0;

  async function runOne() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runOne(),
  );
  await Promise.all(runners);
}

async function getLocBreakdown(
  owner,
  repo,
  branch,
  onProgress,
  token,
  scopeOptions = {},
) {
  const includePaths = scopeOptions.includePaths ?? [];
  const excludePaths = scopeOptions.excludePaths ?? [];
  const useDefaultScopeExclusions =
    scopeOptions.useDefaultScopeExclusions !== false;
  const smartContractOnly = scopeOptions.smartContractOnly === true;

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const treeData = await githubRequest(treeUrl, token);
  if (!treeData.tree || !Array.isArray(treeData.tree)) {
    throw createAppError("api", "Unable to read repository file tree.");
  }

  const files = treeData.tree.filter((entry) => entry.type === "blob");
  if (!files.length) {
    throw createAppError("api", "No files found in this repository.");
  }

  onProgress?.(`Found ${files.length} files. Counting LOC...`);

  const rawBreakdown = {
    solidity: 0,
    rust: 0,
    ccpp: 0,
    other: 0,
  };
  const effectiveBreakdown = {
    solidity: 0,
    rust: 0,
    ccpp: 0,
    other: 0,
  };
  const excludedBreakdown = {
    solidity: 0,
    rust: 0,
    ccpp: 0,
    other: 0,
  };

  let assemblyUnsafeFileCount = 0;
  let upgradabilityKeywordFound = false;
  let openZeppelinDetected = false;

  let processed = 0;
  let skipped = 0;
  let excludedFiles = 0;
  const exclusionReasonCounts = {};

  await mapWithConcurrency(
    files,
    async (file) => {
      if (shouldSkipFile(file.path)) {
        skipped += 1;
        processed += 1;
        if (processed % 25 === 0 || processed === files.length) {
          onProgress?.(
            `Processed ${processed}/${files.length} files (skipped ${skipped}).`,
          );
        }
        return;
      }

      let text = "";
      try {
        text = await fetchBlobContent(owner, repo, branch, file, token);
      } catch (error) {
        if (error?.code === "rate_limit") {
          throw error;
        }
        skipped += 1;
        processed += 1;
        if (processed % 25 === 0 || processed === files.length) {
          onProgress?.(
            `Processed ${processed}/${files.length} files (skipped ${skipped}).`,
          );
        }
        return;
      }

      if (!text || isLikelyBinary(text)) {
        skipped += 1;
        processed += 1;
        if (processed % 25 === 0 || processed === files.length) {
          onProgress?.(
            `Processed ${processed}/${files.length} files (skipped ${skipped}).`,
          );
        }
        return;
      }

      const loc = countEffectiveCodeLines(file.path, text);
      const category = resolveCategory(file.path);
      if (loc > 0) {
        rawBreakdown[category] += loc;
      }

      const ext = getFileExtension(file.path);
      const lowerPath = file.path.toLowerCase();

      if (!openZeppelinDetected) {
        if (ext === "sol" && OPENZEPPELIN_PATTERN.test(text)) {
          openZeppelinDetected = true;
        } else if (
          lowerPath.endsWith("package.json") &&
          packageJsonUsesOpenZeppelin(text)
        ) {
          openZeppelinDetected = true;
        }
      }

      const scopeExclusionReason = getScopeExclusionReason(file.path, text, {
        includePaths,
        excludePaths,
        useDefaultScopeExclusions,
        smartContractOnly,
      });

      if (scopeExclusionReason) {
        excludedFiles += 1;
        if (loc > 0) {
          excludedBreakdown[category] += loc;
        }
        exclusionReasonCounts[scopeExclusionReason] =
          (exclusionReasonCounts[scopeExclusionReason] ?? 0) + 1;
        processed += 1;
        if (processed % 25 === 0 || processed === files.length) {
          onProgress?.(
            `Processed ${processed}/${files.length} files (skipped ${skipped}, excluded ${excludedFiles}).`,
          );
        }
        return;
      }

      if (loc > 0) {
        effectiveBreakdown[category] += loc;
      }

      if (ext === "sol" && ASSEMBLY_PATTERN.test(text)) {
        assemblyUnsafeFileCount += 1;
      } else if (ext === "rs" && UNSAFE_PATTERN.test(text)) {
        assemblyUnsafeFileCount += 1;
      }

      if (
        !upgradabilityKeywordFound &&
        ext === "sol" &&
        UPGRADEABILITY_PATTERN.test(text)
      ) {
        upgradabilityKeywordFound = true;
      }

      processed += 1;

      if (processed % 25 === 0 || processed === files.length) {
        onProgress?.(
          `Processed ${processed}/${files.length} files (skipped ${skipped}, excluded ${excludedFiles}).`,
        );
      }
    },
    8,
  );

  const rawTotalLoc = totalLocFromBreakdown(rawBreakdown);
  const effectiveTotalLoc = totalLocFromBreakdown(effectiveBreakdown);
  const excludedTotalLoc = totalLocFromBreakdown(excludedBreakdown);

  if (effectiveTotalLoc <= 0) {
    throw createAppError(
      "scope",
      "No in-scope LOC found after exclusions. Adjust include/exclude paths.",
    );
  }

  let complexityMultiplier = 1.0;
  const modifiers = [];

  if (assemblyUnsafeFileCount > 2) {
    complexityMultiplier += 0.2;
    modifiers.push({
      label: "Assembly/unsafe penalty",
      impact: +0.2,
      reason: "Detected assembly/unsafe blocks in more than 2 files.",
    });
  }

  if (upgradabilityKeywordFound) {
    complexityMultiplier += 0.1;
    modifiers.push({
      label: "Upgradability tax",
      impact: +0.1,
      reason: "Detected delegatecall/fallback/UUPS/proxy keywords.",
    });
  }

  if (openZeppelinDetected) {
    complexityMultiplier -= 0.15;
    modifiers.push({
      label: "OpenZeppelin discount",
      impact: -0.15,
      reason: "Detected OpenZeppelin dependency/import usage.",
    });
  }

  return {
    breakdown: effectiveBreakdown,
    rawBreakdown,
    excludedBreakdown,
    scopeSummary: {
      includePaths,
      excludePaths,
      useDefaultScopeExclusions,
      smartContractOnly,
      rawTotalLoc,
      effectiveTotalLoc,
      excludedTotalLoc,
      excludedFiles,
      exclusionReasonCounts,
    },
    truncated: Boolean(treeData.truncated),
    complexity: {
      multiplier: complexityMultiplier,
      modifiers,
      assemblyUnsafeFileCount,
      upgradabilityKeywordFound,
      openZeppelinDetected,
    },
  };
}

function calculateEstimates(locBreakdown, mode, complexityMultiplier = 1.0) {
  const totalLoc =
    locBreakdown.solidity +
    locBreakdown.rust +
    locBreakdown.ccpp +
    locBreakdown.other;

  const baseWeeks =
    locBreakdown.solidity / 1000 +
    (locBreakdown.rust + locBreakdown.ccpp) / 1500 +
    locBreakdown.other / 2000;
  const baselineWeeks = baseWeeks * complexityMultiplier;

  const selectedTier = MODE_REDUCTION[mode] ?? MODE_REDUCTION.standard;
  const timeSaved = baselineWeeks * selectedTier;
  const apexWeeks = baselineWeeks - timeSaved + APEX_BUFFER_WEEKS;

  const weeksSaved = baselineWeeks - apexWeeks;
  const percentSaved =
    baselineWeeks > 0
      ? Math.max((weeksSaved / baselineWeeks) * 100, 0)
      : 0;

  return {
    totalLoc,
    baseWeeks,
    complexityMultiplier,
    baselineWeeks,
    baselineCalendarWeeks: baselineWeeks,
    timeSaved,
    apexWeeks,
    apexCalendarWeeks: apexWeeks,
    weeksSaved,
    calendarWeeksSaved: weeksSaved,
    percentSaved,
  };
}

function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompact(value) {
  const fixed = Number(value).toFixed(2);
  return fixed
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function weekLabel(weeks) {
  const rounded = formatCompact(weeks);
  const unit = Number(rounded) === 1 ? "Week" : "Weeks";
  return `${rounded} ${unit}`;
}

function formatModifierImpact(impact) {
  const sign = impact >= 0 ? "+" : "";
  return `${sign}${impact.toFixed(2)}`;
}

function toApexBarWidth(apexWeeks, manualWeeks) {
  if (!manualWeeks || manualWeeks <= 0) {
    return 14;
  }
  const ratio = (apexWeeks / manualWeeks) * 100;
  return Math.min(100, Math.max(12, ratio));
}

function CantinaLogo() {
  return (
    <span className="flex items-center gap-2.5">
      <img
        src={cantinaLogomark}
        alt="Cantina logo"
        className="h-8 w-8"
        loading="eager"
      />
      <span className="text-base font-semibold text-[#F2EEEB]">Cantina</span>
    </span>
  );
}

function FloatingNavbar() {
  return (
    <div className="px-4 pt-4 sm:px-6">
      <nav className="mx-auto h-14 w-full max-w-7xl rounded-full border border-white/10 bg-white/5 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="relative flex h-full items-center justify-between px-4 sm:px-6">
          <a
            href="/"
            className="flex items-center transition-all duration-300 hover:opacity-80"
          >
            <CantinaLogo />
          </a>

          <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
            <a
              href="https://cantina.xyz/solutions/code-analyzer/enterprise"
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-[#E87C40]/18 px-3 py-1 text-sm font-medium text-[#F4A27E] transition-all duration-300"
            >
              Apex
            </a>
            <a
              href="#"
              className="px-3 py-1 text-sm font-medium text-[#A89C95] transition-all duration-300 hover:text-[#F3EEEA]"
            >
              Services
            </a>
            <a
              href="#"
              className="px-3 py-1 text-sm font-medium text-[#A89C95] transition-all duration-300 hover:text-[#F3EEEA]"
            >
              Resources
            </a>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <a
              href="#"
              className="hidden text-sm font-medium text-[#AEA39B] transition-all duration-300 hover:text-[#F2ECE8] sm:inline-flex"
            >
              Login
            </a>
            <a
              href="#calculator"
              className="shimmer-button inline-flex items-center rounded-full bg-[#F4A27E] px-5 py-2 text-sm font-medium text-[#221915] transition-all duration-300 hover:brightness-105 active:scale-[0.98]"
            >
              <span className="relative z-10">Run a Scan</span>
            </a>
          </div>
        </div>
      </nav>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#14181e] p-4">
      <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,#6f5f55_1px,transparent_1px),linear-gradient(to_bottom,#6f5f55_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E8A17D] to-transparent" />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide text-[#AFA49D]">
          {label}
        </p>
        <p className="mt-2 text-xl font-semibold text-[#F4EFEB]">{value}</p>
      </div>
    </div>
  );
}

function BreakdownPill({ label, value }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#12161c] px-3 py-2">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#E87C40]/16 to-transparent" />
      <div className="relative">
        <p className="text-xs uppercase tracking-wide text-[#AFA49D]">{label}</p>
        <p className="mt-1 text-sm font-semibold text-[#F2ECE8]">
          {formatNumber(value, 0)} LOC
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [includePathsInput, setIncludePathsInput] = useState("");
  const [excludePathsInput, setExcludePathsInput] = useState("");
  const [smartContractOnly, setSmartContractOnly] = useState(true);
  const [mode, setMode] = useState("standard");
  const [modeDescriptionVisible, setModeDescriptionVisible] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Enter a public GitHub repository URL to begin.",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [result, setResult] = useState(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [barsLoaded, setBarsLoaded] = useState(false);

  const apexBarWidth = useMemo(() => {
    if (!result) {
      return 14;
    }
    return toApexBarWidth(
      result.estimates.apexCalendarWeeks,
      result.estimates.baselineCalendarWeeks,
    );
  }, [result]);

  const selectedModeCard = useMemo(
    () =>
      MODE_SELECTION_CARDS.find((card) => card.key === mode) ??
      MODE_SELECTION_CARDS[1],
    [mode],
  );

  useEffect(() => {
    let frameOne;
    let frameTwo;

    if (!result) {
      setBarsLoaded(false);
      return undefined;
    }

    setBarsLoaded(false);
    frameOne = requestAnimationFrame(() => {
      frameTwo = requestAnimationFrame(() => setBarsLoaded(true));
    });

    return () => {
      if (frameOne) {
        cancelAnimationFrame(frameOne);
      }
      if (frameTwo) {
        cancelAnimationFrame(frameTwo);
      }
    };
  }, [result]);

  useEffect(() => {
    setModeDescriptionVisible(false);
    const fadeTimer = setTimeout(() => {
      setModeDescriptionVisible(true);
    }, 90);

    return () => clearTimeout(fadeTimer);
  }, [mode]);

  async function handleEstimate(event) {
    event.preventDefault();
    setBanner(null);
    setResult(null);

    let parsedRepo;
    try {
      parsedRepo = parseGitHubUrl(repoUrl);
    } catch (error) {
      setStatusMessage(error.message);
      setBanner({
        tone: "warning",
        message: error.message,
      });
      return;
    }

    setIsLoading(true);
    setStatusMessage("Fetching repository metadata...");
    const authToken = githubToken.trim();
    const includePaths = parseScopePaths(includePathsInput);
    const excludePaths = parseScopePaths(excludePathsInput);

    try {
      const repoData = await githubRequest(
        `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}`,
        authToken,
      );
      if (repoData.private) {
        throw createAppError("private", "Only public repositories are supported.");
      }

      const selectedBranch = branch.trim() || repoData.default_branch;
      setStatusMessage(`Using branch "${selectedBranch}". Building LOC estimates...`);

      const locData = await getLocBreakdown(
        parsedRepo.owner,
        parsedRepo.repo,
        selectedBranch,
        (progressMessage) => setStatusMessage(progressMessage),
        authToken,
        {
          includePaths,
          excludePaths,
          useDefaultScopeExclusions: true,
          smartContractOnly,
        },
      );

      const estimates = calculateEstimates(
        locData.breakdown,
        mode,
        locData.complexity?.multiplier ?? 1.0,
      );

      setResult({
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        branch: selectedBranch,
        locBreakdown: locData.breakdown,
        rawLocBreakdown: locData.rawBreakdown,
        excludedLocBreakdown: locData.excludedBreakdown,
        scopeSummary: locData.scopeSummary,
        truncated: locData.truncated,
        complexity: locData.complexity,
        estimates,
      });

      setStatusMessage(
        `Impact estimate complete. Using ${formatNumber(
          locData.scopeSummary.effectiveTotalLoc,
          0,
        )} in-scope LOC (${formatNumber(
          locData.scopeSummary.excludedTotalLoc,
          0,
        )} excluded).`,
      );

      if (locData.truncated) {
        setBanner({
          tone: "warning",
          message:
            "GitHub returned a truncated tree for this repository. Estimates may be incomplete.",
        });
      }
    } catch (error) {
      const fallbackMessage = error.message || "Unable to estimate impact.";
      setStatusMessage(fallbackMessage);
      if (error?.code === "rate_limit") {
        const rateLimitHelp = authToken
          ? fallbackMessage
          : `${fallbackMessage} Tip: add a GitHub token below to increase rate limits.`;
        setBanner({
          tone: "rate_limit",
          message: rateLimitHelp,
        });
      } else {
        setBanner({
          tone: "warning",
          message: fallbackMessage,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#0F1216] text-[#ECE8E5]">
      <div className="pointer-events-none fixed inset-0 opacity-[0.08] [background-image:radial-gradient(#6a5b52_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#E87C40]/12 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-24 h-80 w-80 rounded-full bg-[#F4A27E]/10 blur-3xl" />

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#080B10] shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,#6f5f55_1px,transparent_1px),linear-gradient(to_bottom,#6f5f55_1px,transparent_1px)] [background-size:26px_26px]" />
          <div className="pointer-events-none absolute left-0 right-0 top-0 h-56 bg-gradient-to-b from-[#131821]/80 to-transparent" />
          <div className="pointer-events-none absolute -right-16 top-12 h-64 w-64 rounded-full bg-gradient-to-tr from-[#F4A27E]/18 to-transparent blur-3xl" />

          <FloatingNavbar />

          <section className="relative px-6 pb-12 pt-10 text-center md:px-14 md:pt-16">
            <div className="mx-auto max-w-3xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-[#E87C40]/45 bg-[#E87C40]/14 px-4 py-1.5 text-xs font-semibold tracking-[0.14em] text-[#F5B292]">
                APEX SECURITY IMPACT
              </span>
              <h1 className="mx-auto max-w-[16ch] text-4xl font-semibold leading-none tracking-tighter text-[#F4EFEC] md:text-6xl">
                One-click audit impact estimation
              </h1>
              <p className="mx-auto max-w-[64ch] text-base leading-relaxed text-[#B8ADA6]">
                Estimate in-scope manual review weeks with strict default
                exclusions, comment-aware SLOC counting, and transparent
                complexity modifiers.
              </p>
              <div className="flex flex-wrap justify-center gap-3 text-sm text-[#C6BBB4]">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
                  <ShieldCheck size={16} weight="regular" className="text-[#F2AB87]" />
                  Scope-safe defaults
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
                  <Timer size={16} weight="regular" className="text-[#F2AB87]" />
                  0.2 week Apex buffer
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
                  <Pulse size={16} weight="regular" className="text-[#F2AB87]" />
                  Comment-aware SLOC
                </span>
              </div>
            </div>
          </section>

          <section
            id="calculator"
            className="relative mx-4 mb-4 overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md md:mx-6 md:mb-6 md:p-8"
          >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#65584f_1px,transparent_1px),linear-gradient(to_bottom,#65584f_1px,transparent_1px)] [background-size:24px_24px]" />
            <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-[#E87C40]/18 to-transparent blur-2xl" />
          </div>

          <div className="relative z-10">
          {banner && (
            <div
              className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
                banner.tone === "rate_limit"
                  ? "border-[#A75A32]/70 bg-[#2A1E17]/80 text-[#F1BC9A]"
                  : "border-[#6A4B3D] bg-[#241A16]/85 text-[#D5B09B]"
              }`}
            >
              {banner.message}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleEstimate}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#AFA39C]"
                  htmlFor="repo-url"
                >
                  GitHub repository URL (public)
                </label>
                <div className="relative">
                  <GithubLogo
                    size={16}
                    weight="regular"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    id="repo-url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="w-full rounded-lg border border-white/15 bg-[#10151c] py-3 pl-10 pr-4 text-[#F2ECE8] outline-none transition placeholder:text-[#7E746E] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/20"
                    required
                  />
                </div>
              </div>
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#AFA39C]"
                  htmlFor="branch"
                >
                  Branch (optional)
                </label>
                <div className="relative">
                  <GitBranch
                    size={16}
                    weight="regular"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    id="branch"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="Default branch"
                    className="w-full rounded-lg border border-white/15 bg-[#10151c] py-3 pl-10 pr-4 text-[#F2ECE8] outline-none transition placeholder:text-[#7E746E] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/20"
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#AFA39C]">
                Manual reduction mode
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.15fr_1fr_1fr]">
                {MODE_SELECTION_CARDS.map((card) => {
                  const isSelected = mode === card.key;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setMode(card.key)}
                      className={`cursor-pointer rounded-xl border border-white/15 bg-[#10151c] p-4 text-left transition-all duration-300 hover:border-[#E87C40]/60 active:scale-[0.98] ${
                        isSelected
                          ? "border-[#E87C40] bg-[#281E18] ring-1 ring-[#E87C40] shadow-[0_12px_24px_rgba(0,0,0,0.25)]"
                          : ""
                      }`}
                    >
                      <p className="font-bold text-[#F3EEEA]">{card.title}</p>
                      <p className="text-2xl font-bold tracking-tight text-[#F1A67D]">
                        {card.percentLabel}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 h-24 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <p
                  className={`text-sm leading-relaxed text-[#B8ADA6] transition-opacity duration-300 ${
                    modeDescriptionVisible ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {selectedModeCard.description}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02]">
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-[#C8BDB6] transition-colors hover:text-[#F2ECE8]"
              >
                <span>Advanced scope controls</span>
                <CaretDown
                  size={16}
                  weight="regular"
                  className={`transition-transform duration-200 ${
                    advancedOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {advancedOpen && (
                <div className="space-y-4 border-t border-white/10 px-4 pb-4 pt-4">
                  <div>
                    <label
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#AFA39C]"
                      htmlFor="github-token"
                    >
                      GitHub token (optional for higher API limits)
                    </label>
                    <div className="relative">
                      <Key
                        size={16}
                        weight="regular"
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                      <input
                        id="github-token"
                        type="password"
                        autoComplete="off"
                        value={githubToken}
                        onChange={(event) => setGithubToken(event.target.value)}
                        placeholder="Enter a valid PAT (kept local in this browser session)"
                        className="w-full rounded-lg border border-white/15 bg-[#10151c] py-3 pl-10 pr-4 text-[#F2ECE8] outline-none transition placeholder:text-[#7E746E] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/20"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#AFA39C]"
                        htmlFor="include-paths"
                      >
                        Include paths (optional)
                      </label>
                      <input
                        id="include-paths"
                        value={includePathsInput}
                        onChange={(event) => setIncludePathsInput(event.target.value)}
                        placeholder="contracts/core, pkg/vault"
                        className="w-full rounded-lg border border-white/15 bg-[#10151c] px-4 py-3 text-[#F2ECE8] outline-none transition placeholder:text-[#7E746E] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/20"
                      />
                    </div>
                    <div>
                      <label
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#AFA39C]"
                        htmlFor="exclude-paths"
                      >
                        Exclude paths (optional)
                      </label>
                      <input
                        id="exclude-paths"
                        value={excludePathsInput}
                        onChange={(event) => setExcludePathsInput(event.target.value)}
                        placeholder="contracts/test, scripts, interfaces"
                        className="w-full rounded-lg border border-white/15 bg-[#10151c] px-4 py-3 text-[#F2ECE8] outline-none transition placeholder:text-[#7E746E] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/20"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-[#AFA39C]">
                    Default scope exclusions are active (tests, interfaces,
                    mocks, scripts, generated and vendor/build folders).
                  </p>

                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/15 bg-white/[0.03] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={smartContractOnly}
                      onChange={(event) => setSmartContractOnly(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/25 bg-[#10151c] text-[#E87C40] focus:ring-[#E87C40]/30"
                    />
                    <span>
                      <span className="text-sm font-medium text-[#E6DFDA]">
                        Smart-contract-only mode (default on)
                      </span>
                      <span className="mt-1 block text-xs text-[#AFA39C]">
                        Excludes the “Other” language bucket from in-scope LOC.
                        Recommended for pure protocol contract audit scoping.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full rounded-lg bg-gradient-to-r from-[#E87C40] to-[#CB5626] px-5 py-3 text-sm font-medium tracking-wide text-[#1C1411] shadow-[inset_0px_1px_0px_rgba(255,255,255,0.2)] transition duration-200 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Calculating..." : "Calculate My Savings"}
            </button>
          </form>

          <p className="mt-4 text-sm text-[#B8ADA6]">{statusMessage}</p>

          {isLoading && (
            <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-full animate-pulse rounded bg-white/10" />
              <div className="h-3 w-10/12 animate-pulse rounded bg-white/10" />
              <div className="h-8 w-full animate-pulse rounded-lg bg-white/10" />
              <div className="h-8 w-4/5 animate-pulse rounded-lg bg-white/10" />
            </div>
          )}

          {!isLoading && !result && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
              <p className="text-sm font-medium text-[#F0EAE6]">
                Awaiting repository input.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[#B6ACA6]">
                Add a public GitHub URL and run the estimate to generate scoped
                review weeks, complexity modifiers, and Apex savings.
              </p>
            </div>
          )}

          {result && (
            <div className="mt-8 border-t border-white/10 pt-8">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-[#B5AAA3]">
                    Visual Comparison
                  </p>
                  <p className="mt-1 text-sm text-[#AFA39C]">
                    {result.owner}/{result.repo} • Branch {result.branch}
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm font-medium text-[#D1C7C1]">
                    <span>Manual Review</span>
                    <span>
                      Est. {weekLabel(result.estimates.baselineCalendarWeeks)}
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-lg bg-[#1F262F]">
                    <div
                      className="h-full origin-left rounded-lg bg-gradient-to-r from-[#69727D] to-[#515B67] transition-transform duration-1000 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]"
                      style={{ transform: barsLoaded ? "scaleX(1)" : "scaleX(0)" }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm font-medium text-[#D1C7C1]">
                    <span>With Apex</span>
                    <span>
                      Est. {weekLabel(result.estimates.apexCalendarWeeks)}
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-lg bg-[#1F262F]">
                    <div style={{ width: `${apexBarWidth}%` }} className="h-full">
                      <div
                        className="h-full origin-left rounded-lg transition-transform duration-1000 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]"
                        style={{
                          transform: barsLoaded ? "scaleX(1)" : "scaleX(0)",
                          backgroundImage: PRIMARY_GRADIENT,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-sm text-[#B7ADA7]">
                  Apex timeline uses a fixed 0.2-week buffer (~1 day) with{" "}
                  <span className="font-medium capitalize">{mode}</span> mode
                  applied.
                </p>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
                <StatCard
                  label="Weeks saved"
                  value={formatNumber(result.estimates.weeksSaved)}
                />
                <StatCard
                  label="Apex estimate (weeks)"
                  value={formatNumber(result.estimates.apexWeeks)}
                />
                <StatCard
                  label="Percent saved"
                  value={`${formatNumber(result.estimates.percentSaved)}%`}
                />
              </div>

              <div className="mt-7 rounded-xl border border-[#3F2B23] bg-[#1A1411] p-5">
                <p className="text-lg font-semibold text-[#F2E9E4]">
                  Ready to speed up your audit?
                </p>
                <button className="mt-4 rounded-lg border border-[#E87C40]/60 px-5 py-2.5 text-sm font-semibold text-[#F4A27E] transition hover:bg-[#E87C40]/20 hover:text-[#F9C4A8] active:scale-[0.98]">
                  Start Your Scan Now
                </button>
              </div>
            </div>
          )}
          </div>
        </section>
        </section>

        {result && (
          <section className="mt-8 grid gap-6 md:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-6">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#E4DDD9]">
                    Complexity multiplier
                  </p>
                  <p className="text-sm font-semibold text-[#F4EFEB]">
                    x{formatNumber(result.estimates.complexityMultiplier)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-[#B3A8A1]">
                  Base weeks before modifiers:{" "}
                  {formatNumber(result.estimates.baseWeeks)}
                </p>
                {result.complexity?.modifiers?.length ? (
                  <ul className="mt-3 space-y-1.5 text-xs text-[#C3B8B2]">
                    {result.complexity.modifiers.map((modifier) => (
                      <li key={modifier.label} className="flex flex-wrap gap-1">
                        <span className="font-medium">{modifier.label}</span>
                        <span className="text-[#BDAFA8]">
                          ({formatModifierImpact(modifier.impact)})
                        </span>
                        <span className="text-[#A89D96]">- {modifier.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-[#A89D96]">
                    No complexity keyword modifiers detected.
                  </p>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
                <StatCard
                  label="Raw LOC scanned"
                  value={formatNumber(result.scopeSummary.rawTotalLoc, 0)}
                />
                <StatCard
                  label="Excluded LOC"
                  value={formatNumber(result.scopeSummary.excludedTotalLoc, 0)}
                />
                <StatCard
                  label="Effective LOC used"
                  value={formatNumber(result.scopeSummary.effectiveTotalLoc, 0)}
                />
              </div>

              {Object.keys(result.scopeSummary.exclusionReasonCounts ?? {})
                .length > 0 && (
                <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#B7ACA5]">
                    Exclusion summary
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-[#B6ACA5]">
                    {Object.entries(result.scopeSummary.exclusionReasonCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([reason, count]) => (
                        <li key={reason}>
                          {reason}: {count} files
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[#B7ACA5]">
                Effective LOC breakdown (used in estimate)
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <BreakdownPill
                  label="Total"
                  value={result.estimates.totalLoc}
                />
                <BreakdownPill
                  label="Solidity"
                  value={result.locBreakdown.solidity}
                />
                <BreakdownPill label="Rust" value={result.locBreakdown.rust} />
                <BreakdownPill
                  label="C/C++"
                  value={result.locBreakdown.ccpp}
                />
                <BreakdownPill
                  label="Other"
                  value={result.locBreakdown.other}
                />
              </div>
            </div>

            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-6">
              <button
                type="button"
                onClick={() => setAssumptionsOpen((isOpen) => !isOpen)}
                className="flex cursor-pointer items-center gap-2 text-sm text-[#B5AAA3] transition-colors hover:text-[#F2ECE8]"
              >
                <CaretDown
                  size={16}
                  weight="regular"
                  className={`transition-transform duration-200 ${
                    assumptionsOpen ? "rotate-180" : ""
                  }`}
                />
                <span>How is this calculated?</span>
              </button>
              {assumptionsOpen && (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#B8ADA6]">
                  <li>Solidity: 1000 code LOC ≈ 1 week.</li>
                  <li>Rust + C/C++: 1500 code LOC ≈ 1 week.</li>
                  <li>Other: 2000 code LOC ≈ 1 week.</li>
                  <li>
                    LOC counting excludes blank lines and comment-only lines
                    where supported.
                  </li>
                  <li>
                    Effective LOC excludes tests, interfaces, mocks, scripts,
                    and generated/vendor/build directories by default.
                  </li>
                  <li>
                    Optional include/exclude path filters can further narrow
                    audit scope.
                  </li>
                  <li>
                    Smart-contract-only mode excludes the entire “Other” bucket
                    from in-scope LOC.
                  </li>
                  <li>
                    Complexity multiplier starts at 1.0 and modifies the
                    estimate: Final Weeks = Base Weeks × complexityMultiplier.
                  </li>
                  <li>
                    Assembly/unsafe penalty: +0.20 if Solidity{" "}
                    <code>assembly</code> or Rust <code>unsafe</code> appears in
                    more than 2 files.
                  </li>
                  <li>
                    Upgradability tax: +0.10 if any of <code>delegatecall</code>,{" "}
                    <code>fallback</code>, <code>UUPS</code>, or{" "}
                    <code>TransparentUpgradeableProxy</code> is detected in
                    Solidity.
                  </li>
                  <li>
                    OpenZeppelin discount: -0.15 if OpenZeppelin is detected in{" "}
                    <code>package.json</code> dependencies or Solidity imports.
                  </li>
                  <li>Apex timeline adds a fixed 0.2-week buffer (~1 day).</li>
                  <li>
                    Mode reductions for manual review: Conservative 20%,
                    Standard 35%, Strong 50%.
                  </li>
                  <li>
                    LOC-based estimation only. No vulnerability detection or
                    catch-rate claims are included.
                  </li>
                </ul>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
