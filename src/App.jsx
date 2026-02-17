import { useMemo, useState } from "react";
import cantinaWordmark from "./assets/cantina-wordmark-brand-black.svg";

const BRAND_GRADIENT =
  "linear-gradient(to right, #F4A27E, #E87C40, #CB5626, #7B3515)";

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

async function githubRequest(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
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

async function fetchBlobContent(owner, repo, branch, file) {
  const blobUrl = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${file.sha}`;
  const blobData = await githubRequest(blobUrl);

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

async function getLocBreakdown(owner, repo, branch, onProgress) {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const treeData = await githubRequest(treeUrl);
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
        text = await fetchBlobContent(owner, repo, branch, file);
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
      processed += 1;

      if (processed % 25 === 0 || processed === files.length) {
        onProgress?.(
          `Processed ${processed}/${files.length} files (skipped ${skipped}).`,
        );
      }
    },
    8,
  );

  return {
    breakdown,
    truncated: Boolean(treeData.truncated),
  };
}

function calculateEstimates(locBreakdown, reviewers, mode) {
  const totalLoc =
    locBreakdown.solidity +
    locBreakdown.rust +
    locBreakdown.ccpp +
    locBreakdown.other;

  const baselineReviewerWeeks =
    locBreakdown.solidity / 1000 +
    (locBreakdown.rust + locBreakdown.ccpp) / 1500 +
    locBreakdown.other / 2000;
  const baselineCalendarWeeks = baselineReviewerWeeks / reviewers;

  const reduction = MODE_REDUCTION[mode] ?? MODE_REDUCTION.standard;
  const apexManualReviewerWeeks = baselineReviewerWeeks * (1 - reduction);
  const apexCalendarWeeks = apexManualReviewerWeeks / reviewers + 1 / 7;

  const reviewerWeeksSaved = baselineReviewerWeeks - apexManualReviewerWeeks;
  const calendarWeeksSaved = baselineCalendarWeeks - apexCalendarWeeks;
  const percentSaved =
    baselineCalendarWeeks > 0
      ? Math.max((calendarWeeksSaved / baselineCalendarWeeks) * 100, 0)
      : 0;

  return {
    totalLoc,
    baselineReviewerWeeks,
    baselineCalendarWeeks,
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

function toApexBarWidth(apexWeeks, manualWeeks) {
  if (!manualWeeks || manualWeeks <= 0) {
    return 14;
  }
  const ratio = (apexWeeks / manualWeeks) * 100;
  return Math.min(100, Math.max(12, ratio));
}

function CantinaLogo() {
  return (
    <img
      src={cantinaWordmark}
      alt="Cantina"
      className="h-9 w-auto sm:h-10"
      loading="eager"
    />
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-[#EDE6E2] bg-[#FFFEFE] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[#8A786F]">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-[#3E2B26]">{value}</p>
    </div>
  );
}

function BreakdownPill({ label, value }) {
  return (
    <div className="rounded-lg border border-[#EEE7E3] bg-[#FAF8F7] px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-[#8A786F]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#3E2B26]">
        {formatNumber(value, 0)} LOC
      </p>
    </div>
  );
}

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [reviewers, setReviewers] = useState(2);
  const [mode, setMode] = useState("standard");
  const [statusMessage, setStatusMessage] = useState(
    "Enter a public GitHub repository URL to begin.",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [result, setResult] = useState(null);

  const apexBarWidth = useMemo(() => {
    if (!result) {
      return 14;
    }
    return toApexBarWidth(
      result.estimates.apexCalendarWeeks,
      result.estimates.baselineCalendarWeeks,
    );
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

    try {
      const repoData = await githubRequest(
        `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}`,
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
      );

      const estimates = calculateEstimates(
        locData.breakdown,
        Math.max(1, Math.round(reviewerCount)),
        mode,
      );

      setResult({
        owner: parsedRepo.owner,
        repo: parsedRepo.repo,
        branch: selectedBranch,
        locBreakdown: locData.breakdown,
        truncated: locData.truncated,
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
      setStatusMessage(error.message || "Unable to estimate impact.");
      if (error?.code === "rate_limit") {
        setBanner({
          tone: "rate_limit",
          message: error.message,
        });
      } else {
        setBanner({
          tone: "warning",
          message: error.message || "Unable to estimate impact.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-[#3E2B26]">
      <div className="pointer-events-none absolute -right-28 -top-40 h-[30rem] w-[30rem] rounded-full bg-[#F4A27E]/35 blur-[120px]" />

      <header className="relative z-10 border-b border-[#F1EAE7] bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center px-6 py-4">
          <CantinaLogo />
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-20 pt-14">
        <section className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-[#3E2B26]">
            Accelerate Your Audit Readiness
          </h1>
          <p className="mt-4 text-lg text-[#7C6D66]">
            See how Cantina Apex reduces manual security review time by up to
            50%. Enter your repo to estimate your savings.
          </p>
        </section>

        <section className="mt-10 rounded-2xl border border-[#F1E9E5] bg-white p-8 shadow-xl shadow-[#7B3515]/10">
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
                  className="mb-2 block text-sm font-medium text-[#6D5C55]"
                  htmlFor="repo-url"
                >
                  GitHub repository URL (public)
                </label>
                <input
                  id="repo-url"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full rounded-lg border border-[#DCD4D0] bg-white px-4 py-3 text-[#3E2B26] outline-none transition placeholder:text-[#AC9F99] focus:border-[#E87C40] focus:ring-2 focus:ring-[#F4A27E]/35"
                  required
                />
              </div>
              <div>
                <label
                  className="mb-2 block text-sm font-medium text-[#6D5C55]"
                  htmlFor="branch"
                >
                  Branch (optional)
                </label>
                <input
                  id="branch"
                  value={branch}
                  onChange={(event) => setBranch(event.target.value)}
                  placeholder="Default branch"
                  className="w-full rounded-lg border border-[#DCD4D0] bg-white px-4 py-3 text-[#3E2B26] outline-none transition placeholder:text-[#AC9F99] focus:border-[#E87C40] focus:ring-2 focus:ring-[#F4A27E]/35"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  className="mb-2 block text-sm font-medium text-[#6D5C55]"
                  htmlFor="reviewers"
                >
                  Reviewers
                </label>
                <input
                  id="reviewers"
                  type="number"
                  min="1"
                  step="1"
                  value={reviewers}
                  onChange={(event) => setReviewers(event.target.value)}
                  className="w-full rounded-lg border border-[#DCD4D0] bg-white px-4 py-3 text-[#3E2B26] outline-none transition focus:border-[#E87C40] focus:ring-2 focus:ring-[#F4A27E]/35"
                />
              </div>
              <div>
                <label
                  className="mb-2 block text-sm font-medium text-[#6D5C55]"
                  htmlFor="mode"
                >
                  Manual reduction mode
                </label>
                <select
                  id="mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                  className="w-full rounded-lg border border-[#DCD4D0] bg-white px-4 py-3 text-[#3E2B26] outline-none transition focus:border-[#E87C40] focus:ring-2 focus:ring-[#F4A27E]/35"
                >
                  <option value="conservative">Conservative</option>
                  <option value="standard">Standard</option>
                  <option value="strong">Strong</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full rounded-lg px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundImage: BRAND_GRADIENT }}
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
                  <div className="h-4 w-full overflow-hidden rounded-full bg-[#ECE6E2]">
                    <div className="h-full w-full rounded-full bg-[#CFC6C1]" />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm font-medium text-[#6D5C55]">
                    <span>With Apex</span>
                    <span>
                      Est. {weekLabel(result.estimates.apexCalendarWeeks)}
                    </span>
                  </div>
                  <div className="h-4 w-full overflow-hidden rounded-full bg-[#F4EFEC]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${apexBarWidth}%`,
                        backgroundImage: BRAND_GRADIENT,
                      }}
                    />
                  </div>
                </div>

                <p className="text-sm text-[#7B6A62]">
                  Apex results delivered in 1 day (fixed assumption) with{" "}
                  <span className="font-medium capitalize">{mode}</span> mode
                  applied.
                </p>
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

          <details className="mt-6 rounded-lg border border-[#ECE3DE] bg-[#FCFAF8] p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[#5D4B45]">
              How is this calculated?
            </summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[#786860]">
              <li>Solidity: 1000 LOC ≈ 1 reviewer-week.</li>
              <li>Rust + C/C++: 1500 LOC ≈ 1 reviewer-week.</li>
              <li>Other: 2000 LOC ≈ 1 reviewer-week.</li>
              <li>Apex timeline assumes fixed delivery in 1 day.</li>
              <li>
                Mode reductions for manual review: Conservative 20%, Standard
                35%, Strong 50%.
              </li>
              <li>
                LOC-based estimation only. No vulnerability detection or
                catch-rate claims are included.
              </li>
            </ul>
          </details>
        </section>
      </main>
    </div>
  );
}
