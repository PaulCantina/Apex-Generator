import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  GitBranch,
  Github,
  KeyRound,
  Users,
} from "lucide-react";
import cantinaLogomark from "./assets/cantina-logomark-color-dark.svg";

const PRIMARY_GRADIENT = "linear-gradient(to right, #E87C40, #CB5626)";
const APEX_BUFFER_WEEKS = 0.2;

const MODE_REDUCTION = {
  conservative: 0.2,
  standard: 0.35,
  strong: 0.5,
};

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

async function getLocBreakdown(owner, repo, branch, onProgress, token) {
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

  const breakdown = {
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

      const loc = countNonEmptyLines(text);
      breakdown[resolveCategory(file.path)] += loc;

      const ext = getFileExtension(file.path);
      if (ext === "sol") {
        if (ASSEMBLY_PATTERN.test(text)) {
          assemblyUnsafeFileCount += 1;
        }
        if (!openZeppelinDetected && OPENZEPPELIN_PATTERN.test(text)) {
          openZeppelinDetected = true;
        }
      } else if (ext === "rs" && UNSAFE_PATTERN.test(text)) {
        assemblyUnsafeFileCount += 1;
      }

      if (
        !openZeppelinDetected &&
        file.path.toLowerCase().endsWith("package.json") &&
        packageJsonUsesOpenZeppelin(text)
      ) {
        openZeppelinDetected = true;
      }

      if (!upgradabilityKeywordFound && UPGRADEABILITY_PATTERN.test(text)) {
        upgradabilityKeywordFound = true;
      }

      processed += 1;

      if (processed % 25 === 0 || processed === files.length) {
        onProgress?.(
          `Processed ${processed}/${files.length} files (skipped ${skipped}).`,
        );
      }
    },
    8,
  );

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
    breakdown,
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

function calculateEstimates(locBreakdown, reviewers, mode, complexityMultiplier = 1.0) {
  const totalLoc =
    locBreakdown.solidity +
    locBreakdown.rust +
    locBreakdown.ccpp +
    locBreakdown.other;

  const baseReviewerWeeks =
    locBreakdown.solidity / 1000 +
    (locBreakdown.rust + locBreakdown.ccpp) / 1500 +
    locBreakdown.other / 2000;
  const baselineReviewerWeeks = baseReviewerWeeks * complexityMultiplier;
  const manualWeeks = baselineReviewerWeeks / reviewers;

  const selectedTier = MODE_REDUCTION[mode] ?? MODE_REDUCTION.standard;
  const timeSaved = manualWeeks * selectedTier;
  const apexCalendarWeeks = manualWeeks - timeSaved + APEX_BUFFER_WEEKS;
  const apexManualReviewerWeeks = baselineReviewerWeeks * (1 - selectedTier);

  const reviewerWeeksSaved = baselineReviewerWeeks - apexManualReviewerWeeks;
  const calendarWeeksSaved = manualWeeks - apexCalendarWeeks;
  const percentSaved =
    manualWeeks > 0
      ? Math.max((calendarWeeksSaved / manualWeeks) * 100, 0)
      : 0;

  return {
    totalLoc,
    baseReviewerWeeks,
    complexityMultiplier,
    baselineReviewerWeeks,
    baselineCalendarWeeks: manualWeeks,
    manualWeeks,
    timeSaved,
    apexManualReviewerWeeks,
    apexCalendarWeeks,
    reviewerWeeksSaved,
    calendarWeeksSaved,
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
      <span className="text-base font-semibold text-gray-900">Cantina</span>
    </span>
  );
}

function FloatingNavbar() {
  return (
    <div className="fixed inset-x-0 top-4 z-50 px-3 sm:px-6">
      <nav className="mx-auto h-16 w-full max-w-5xl rounded-full border border-white/20 bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
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
              className="rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-orange-600 transition-all duration-300"
            >
              Apex
            </a>
            <a
              href="#"
              className="px-3 py-1 text-sm font-medium text-gray-500 transition-all duration-300 hover:text-gray-900"
            >
              Services
            </a>
            <a
              href="#"
              className="px-3 py-1 text-sm font-medium text-gray-500 transition-all duration-300 hover:text-gray-900"
            >
              Resources
            </a>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <a
              href="#"
              className="hidden text-sm font-medium text-gray-600 transition-all duration-300 hover:text-black sm:inline-flex"
            >
              Login
            </a>
            <a
              href="#calculator"
              className="shimmer-button inline-flex items-center rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-all duration-300 hover:bg-black"
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
    <div className="relative overflow-hidden rounded-xl border border-[#EDE6E2] bg-[linear-gradient(165deg,#ffffff_0%,#fdf9f7_100%)] p-4">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#d8dde6_1px,transparent_1px),linear-gradient(to_bottom,#d8dde6_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#E8C1AF] to-transparent" />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-wide text-[#8A786F]">
          {label}
        </p>
        <p className="mt-2 text-xl font-semibold text-[#3E2B26]">{value}</p>
      </div>
    </div>
  );
}

function BreakdownPill({ label, value }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-[#EEE7E3] bg-[linear-gradient(165deg,#fdfbfa_0%,#f7f2ef_100%)] px-3 py-2">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#E87C40]/10 to-transparent" />
      <div className="relative">
        <p className="text-xs uppercase tracking-wide text-[#8A786F]">{label}</p>
        <p className="mt-1 text-sm font-semibold text-[#3E2B26]">
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
  const [reviewers, setReviewers] = useState(2);
  const [mode, setMode] = useState("standard");
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

    const reviewerCount = Number(reviewers);
    if (!Number.isFinite(reviewerCount) || reviewerCount < 1) {
      const message = "Reviewer count must be at least 1.";
      setStatusMessage(message);
      setBanner({
        tone: "warning",
        message,
      });
      return;
    }

    setIsLoading(true);
    setStatusMessage("Fetching repository metadata...");
    const authToken = githubToken.trim();

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
      );

      const estimates = calculateEstimates(
        locData.breakdown,
        Math.max(1, Math.round(reviewerCount)),
        mode,
        locData.complexity?.multiplier ?? 1.0,
      );

      setResult({
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        branch: selectedBranch,
        locBreakdown: locData.breakdown,
        truncated: locData.truncated,
        complexity: locData.complexity,
        estimates,
      });

      setStatusMessage("Impact estimate complete.");

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
    <div className="relative min-h-screen overflow-hidden bg-white text-[#3E2B26]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-5 [background-image:radial-gradient(#7b3515_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="pointer-events-none absolute -right-32 -top-44 h-[34rem] w-[34rem] rounded-full bg-gradient-to-tr from-[#FF6B35]/10 to-transparent blur-3xl" />

      <FloatingNavbar />

      <main className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20 pt-32 md:pt-36">
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-4">
            <span className="inline-flex items-center rounded-full bg-[#E87C40]/10 px-4 py-1.5 text-xs font-semibold tracking-[0.14em] text-[#CB5626]">
              APEX SECURITY IMPACT
            </span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-[#3E2B26]">
            Accelerate Your Audit Readiness
          </h1>
          <p className="mt-4 text-lg text-[#7C6D66]">
            See how Cantina Apex reduces manual security review time by up to
            50%. Enter your repo to estimate your savings.
          </p>
        </section>

        <section
          id="calculator"
          className="relative mt-10 overflow-hidden rounded-2xl border border-gray-100 bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,#d8dde6_1px,transparent_1px),linear-gradient(to_bottom,#d8dde6_1px,transparent_1px)] [background-size:22px_22px]" />
            <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-[#E87C40]/12 to-transparent blur-2xl" />
            <div className="absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-gradient-to-tr from-[#9CB6FF]/10 to-transparent blur-2xl" />
          </div>

          <div className="relative z-10">
          {banner && (
            <div
              className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
                banner.tone === "rate_limit"
                  ? "border-[#F0BB96] bg-[#FFF4EA] text-[#85502D]"
                  : "border-[#EED3C3] bg-[#FFF7F2] text-[#744B37]"
              }`}
            >
              {banner.message}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleEstimate}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  htmlFor="repo-url"
                >
                  GitHub repository URL (public)
                </label>
                <div className="relative">
                  <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="repo-url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-[#3E2B26] outline-none transition placeholder:text-[#AC9F99] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/10"
                    required
                  />
                </div>
              </div>
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  htmlFor="branch"
                >
                  Branch (optional)
                </label>
                <div className="relative">
                  <GitBranch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="branch"
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="Default branch"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-[#3E2B26] outline-none transition placeholder:text-[#AC9F99] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/10"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  htmlFor="reviewers"
                >
                  Reviewers
                </label>
                <div className="relative">
                  <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    id="reviewers"
                    type="number"
                    min="1"
                    step="1"
                    value={reviewers}
                    onChange={(event) => setReviewers(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-[#3E2B26] outline-none transition focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/10"
                  />
                </div>
              </div>
              <div>
                <label
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  htmlFor="mode"
                >
                  Manual reduction mode
                </label>
                <select
                  id="mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3 text-[#3E2B26] outline-none transition focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/10"
                >
                  <option value="conservative">Conservative</option>
                  <option value="standard">Standard</option>
                  <option value="strong">Strong</option>
                </select>
              </div>
            </div>

            <div>
              <label
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                htmlFor="github-token"
              >
                GitHub token (optional for higher API limits)
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="github-token"
                  type="password"
                  autoComplete="off"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.target.value)}
                  placeholder="Enter a valid PAT (kept local in this browser session)"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50/50 py-3 pl-10 pr-4 text-[#3E2B26] outline-none transition placeholder:text-[#AC9F99] focus:border-[#E87C40] focus:ring-4 focus:ring-[#E87C40]/10"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full rounded-lg bg-gradient-to-r from-[#E87C40] to-[#CB5626] px-5 py-3 text-sm font-medium tracking-wide text-white shadow-[inset_0px_1px_0px_rgba(255,255,255,0.2)] transition duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Calculating..." : "Calculate My Savings"}
            </button>
          </form>

          <p className="mt-4 text-sm text-[#7E6F68]">{statusMessage}</p>

          {result && (
            <div className="mt-8 border-t border-[#F1EAE6] pt-8">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-[#8C7A71]">
                    Visual Comparison
                  </p>
                  <p className="mt-1 text-sm text-[#7D6C64]">
                    {result.owner}/{result.repo} • Branch {result.branch}
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm font-medium text-[#6D5C55]">
                    <span>Manual Review</span>
                    <span>
                      Est. {weekLabel(result.estimates.baselineCalendarWeeks)}
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-lg bg-gradient-to-r from-[#F0EBE8] to-[#E5DEDA]">
                    <div
                      className="h-full rounded-lg bg-gradient-to-r from-[#CFC4BF] to-[#B5A9A4] transition-[width] duration-1000 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]"
                      style={{ width: barsLoaded ? "100%" : "0%" }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm font-medium text-[#6D5C55]">
                    <span>With Apex</span>
                    <span>
                      Est. {weekLabel(result.estimates.apexCalendarWeeks)}
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-lg bg-[#F5EEEA]">
                    <div
                      className="h-full rounded-lg transition-[width] duration-1000 [transition-timing-function:cubic-bezier(0.25,1,0.5,1)]"
                      style={{
                        width: barsLoaded ? `${apexBarWidth}%` : "0%",
                        backgroundImage: PRIMARY_GRADIENT,
                      }}
                    />
                  </div>
                </div>

                <p className="text-sm text-[#7B6A62]">
                  Apex timeline uses a fixed 0.2-week buffer (~1 day) with{" "}
                  <span className="font-medium capitalize">{mode}</span> mode
                  applied.
                </p>
              </div>

              <div className="mt-5 rounded-xl border border-[#E6DDD9] bg-[#FBF8F6] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#5F4E47]">
                    Complexity multiplier
                  </p>
                  <p className="text-sm font-semibold text-[#3E2B26]">
                    x{formatNumber(result.estimates.complexityMultiplier)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-[#85746D]">
                  Base reviewer-weeks before modifiers:{" "}
                  {formatNumber(result.estimates.baseReviewerWeeks)}
                </p>
                {result.complexity?.modifiers?.length ? (
                  <ul className="mt-3 space-y-1.5 text-xs text-[#6F5D55]">
                    {result.complexity.modifiers.map((modifier) => (
                      <li key={modifier.label} className="flex flex-wrap gap-1">
                        <span className="font-medium">{modifier.label}</span>
                        <span className="text-[#7D6A62]">
                          ({formatModifierImpact(modifier.impact)})
                        </span>
                        <span className="text-[#8C7A72]">- {modifier.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-[#8C7A72]">
                    No complexity keyword modifiers detected.
                  </p>
                )}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard
                  label="Reviewer-weeks saved"
                  value={formatNumber(result.estimates.reviewerWeeksSaved)}
                />
                <StatCard
                  label="Calendar weeks saved"
                  value={formatNumber(result.estimates.calendarWeeksSaved)}
                />
                <StatCard
                  label="Percent saved"
                  value={`${formatNumber(result.estimates.percentSaved)}%`}
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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

              <div className="mt-7 rounded-xl border border-[#E8DFDB] bg-[#FBF9F8] p-5">
                <p className="text-lg font-semibold text-[#3E2B26]">
                  Ready to speed up your audit?
                </p>
                <button className="mt-4 rounded-lg border border-[#3E2B26] px-5 py-2.5 text-sm font-semibold text-[#3E2B26] transition hover:bg-[#3E2B26] hover:text-white">
                  Start Your Scan Now
                </button>
              </div>
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setAssumptionsOpen((isOpen) => !isOpen)}
              className="flex cursor-pointer items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${
                  assumptionsOpen ? "rotate-180" : ""
                }`}
              />
              <span>How is this calculated?</span>
            </button>
            {assumptionsOpen && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#786860]">
                <li>Solidity: 1000 LOC ≈ 1 reviewer-week.</li>
                <li>Rust + C/C++: 1500 LOC ≈ 1 reviewer-week.</li>
                <li>Other: 2000 LOC ≈ 1 reviewer-week.</li>
                <li>
                  Complexity multiplier starts at 1.0 and modifies the estimate:
                  Final Weeks = Base Weeks × complexityMultiplier.
                </li>
                <li>
                  Assembly/unsafe penalty: +0.20 if Solidity <code>assembly</code>
                  or Rust <code>unsafe</code> appears in more than 2 files.
                </li>
                <li>
                  Upgradability tax: +0.10 if any of <code>delegatecall</code>,{" "}
                  <code>fallback</code>, <code>UUPS</code>, or{" "}
                  <code>TransparentUpgradeableProxy</code> is detected.
                </li>
                <li>
                  OpenZeppelin discount: -0.15 if OpenZeppelin is detected in{" "}
                  <code>package.json</code> dependencies or Solidity imports.
                </li>
                <li>Apex timeline adds a fixed 0.2-week buffer (~1 day).</li>
                <li>
                  Mode reductions for manual review: Conservative 20%, Standard
                  35%, Strong 50%.
                </li>
                <li>
                  LOC-based estimation only. No vulnerability detection or
                  catch-rate claims are included.
                </li>
              </ul>
            )}
          </div>
          </div>
        </section>
      </main>
    </div>
  );
}
