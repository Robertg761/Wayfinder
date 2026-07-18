const apiUrl = process.env.WAYFINDER_API_URL ?? "https://wayfinder-api.hopit-robert.workers.dev";

const repositoryCases = {
  node: {
    owner: "openai",
    repo: "openai-node",
    question: "Where is pagination implemented?",
    expectedTopPath: "src/core/pagination.ts",
  },
  python: {
    owner: "pallets",
    repo: "flask",
    question: "Where is request routing implemented?",
    expectedTopPaths: ["src/flask/sansio/app.py", "src/flask/sansio/scaffold.py"],
  },
  rust: {
    owner: "BurntSushi",
    repo: "ripgrep",
    question: "Which file defines the command line executable?",
    expectedTopPath: "crates/core/main.rs",
  },
  go: {
    owner: "cli",
    repo: "cli",
    question: "Where is authentication handled?",
  },
  monorepo: {
    owner: "vercel",
    repo: "next.js",
    question: "Where is routing implemented?",
    expectedTopPaths: [
      "packages/next/src/shared/lib/router/routes/app.ts",
      "packages/next-routing/src/index.ts",
    ],
  },
};

async function requestJson(path, init) {
  const response = await fetch(apiUrl + path, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.message ?? body?.error ?? response.statusText;
    throw new Error(`${path} returned ${response.status}: ${detail}`);
  }
  return body;
}

async function post(path, body) {
  return requestJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawUrl(map, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${map.repo}/${map.sha}/${encoded}`;
}

async function verifyPath(map, path) {
  const response = await fetch(rawUrl(map, path), { method: "HEAD", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
}

async function verifyRepository(name, repositoryCase) {
  const map = await post("/map", {
    owner: repositoryCase.owner,
    repo: repositoryCase.repo,
  });

  const orientation = await post("/agent", {
    map,
    query: "What does this repository do?",
    currentPath: null,
  });
  const development = await post("/agent", {
    map,
    query: "How do I run the tests for this repository?",
    currentPath: null,
  });
  const consumer = await post("/agent", {
    map,
    query: "How do I install this as an end user?",
    currentPath: null,
  });
  const finder = await post("/agent", {
    map,
    query: repositoryCase.question,
    currentPath: null,
  });

  if (orientation.intent !== "orientation" || orientation.tour.stops.length === 0) {
    throw new Error("orientation did not return a reading route");
  }
  if (!orientation.tour.runtimeEntryPoint?.path || /(^|\/)(readme[^/]*\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i.test(orientation.tour.runtimeEntryPoint.path)) {
    throw new Error(`orientation returned an invalid runtime entry point: ${orientation.tour.runtimeEntryPoint?.path ?? "none"}`);
  }
  if (development.intent !== "installation" || development.guide.audience !== "develop") {
    throw new Error("test question did not reach the repository development guide");
  }
  if (development.guide.steps.some((step) => step.title === "Install the published package")) {
    throw new Error("development guide included a consumer package install");
  }
  if (consumer.intent !== "installation" || consumer.guide.audience !== "use") {
    throw new Error("end-user install question did not reach the consumer guide");
  }
  if (finder.intent !== "file-find" || finder.finder.results.length === 0) {
    throw new Error("file question did not return a repository coordinate");
  }

  const topPath = finder.finder.results[0].path;
  if (repositoryCase.expectedTopPath && topPath !== repositoryCase.expectedTopPath) {
    throw new Error(`expected ${repositoryCase.expectedTopPath}, received ${topPath}`);
  }
  if (repositoryCase.expectedTopPaths && !repositoryCase.expectedTopPaths.includes(topPath)) {
    throw new Error(`expected one of ${repositoryCase.expectedTopPaths.join(", ")}, received ${topPath}`);
  }

  const evidencePaths = [
    orientation.tour.runtimeEntryPoint.path,
    development.guide.steps[0]?.evidence.path,
    consumer.guide.steps[0]?.evidence.path,
    topPath,
  ].filter(Boolean);
  await Promise.all([...new Set(evidencePaths)].map((path) => verifyPath(map, path)));

  return {
    case: name,
    repo: map.repo,
    sha: map.sha,
    language: map.language,
    truncated: map.truncated,
    tourStops: orientation.tour.stops.length,
    runtimeEntryPoint: orientation.tour.runtimeEntryPoint.path,
    developmentAudience: development.guide.audience,
    developmentSteps: development.guide.steps.map((step) => step.command),
    consumerAudience: consumer.guide.audience,
    consumerSteps: consumer.guide.steps.map((step) => step.command),
    consumerWarnings: consumer.guide.warnings,
    question: repositoryCase.question,
    topPath,
    topConfidence: finder.finder.results[0].confidence,
    verifiedEvidence: evidencePaths,
  };
}

const requested = process.argv.slice(2);
const selected = requested.length > 0 ? requested : Object.keys(repositoryCases);
const unknown = selected.filter((name) => !repositoryCases[name]);
if (unknown.length > 0) {
  throw new Error(`Unknown cases: ${unknown.join(", ")}. Choose from ${Object.keys(repositoryCases).join(", ")}.`);
}

const health = await requestJson("/health");
if (!health.ok || !health.apiProtected) {
  throw new Error(`health check did not confirm public API protection: ${JSON.stringify(health)}`);
}
console.log(JSON.stringify({ health }, null, 2));

for (const name of selected) {
  const result = await verifyRepository(name, repositoryCases[name]);
  console.log(JSON.stringify(result, null, 2));
}
