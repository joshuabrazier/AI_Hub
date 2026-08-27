// -------------------------------------------------------------------
// A fake SharePoint, for local development
//
// Answers the four Graph endpoints the crawl uses, the way Microsoft's own
// reference says Graph answers them. Point DEV_FAKE_SHAREPOINT_URL at this
// and the whole feature works end to end with no Entra tenant, no app
// registration and no consent.
//
// WHAT IT PROVES: the state machine. Paging, the write-then-advance
// ordering, the delta link being stored only on reaching the end, resume
// from a saved nextLink across two slices, tombstones and soft delete,
// incremental crawls, and throttle parking.
//
// WHAT IT CANNOT PROVE: that your tenant works. This answers the way the
// documentation says Graph answers, which is precisely the thing that might
// be wrong. It is a test of our code, not of the contract.
//
// It is deliberately dependency-free and deliberately not in src/ - nothing
// the app ships imports it, and it never runs in a deployed environment.
//
// Run:
//   pnpm dev:fake-sharepoint
//
// Env:
//   FAKE_SHAREPOINT_PORT     default 4400
//   FAKE_SHAREPOINT_ITEMS    how many items in the library, default 3000.
//                            The default is chosen to exceed one slice:
//                            100 per page is 30 pages against a 25-page
//                            slice, so a full crawl takes TWO sweeps and
//                            resume gets exercised rather than skipped.
//   FAKE_SHAREPOINT_THROTTLE_PAGE
//                            answer 429 once when this page is requested.
//                            Unset = never.
//   FAKE_SHAREPOINT_RETRY_AFTER
//                            seconds on that 429, default 120.
//
//                            THE VALUE PICKS WHICH BRANCH YOU EXERCISE, so
//                            it is worth knowing which one you want. At or
//                            under MAX_HONOURED_RETRY_AFTER_SECONDS (60)
//                            the client waits it out inline and retries, so
//                            the crawl just pauses and carries on. Above it
//                            the crawl PARKS: status paused_throttled,
//                            throttled_until set, and the next sweep leaves
//                            it alone until that passes. 120 is the default
//                            because minutes is what SharePoint really asks
//                            for, and parking is the branch worth seeing.
// -------------------------------------------------------------------
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_SHAREPOINT_PORT ?? 4400);
const TOTAL_ITEMS = Number(process.env.FAKE_SHAREPOINT_ITEMS ?? 3000);
const THROTTLE_PAGE = process.env.FAKE_SHAREPOINT_THROTTLE_PAGE
  ? Number(process.env.FAKE_SHAREPOINT_THROTTLE_PAGE)
  : null;

// Graph returns a few hundred per page; 100 keeps the page count high
// enough to be interesting without making the payloads unwieldy.
const PAGE_SIZE = 100;

const RETRY_AFTER_SECONDS = Number(process.env.FAKE_SHAREPOINT_RETRY_AFTER ?? 120);

const DRIVE_ID = "b!fake-drive-documents";
const SITE_ID = "fake-site";

const DEPARTMENTS = [
  "Finance",
  "Legal",
  "Marketing",
  "Operations",
  "People and Culture",
  "Projects",
  "Sales",
  "Support",
  "Engineering",
  "Compliance",
  "Archive",
  "Templates",
];

// One of these is deliberately awful. A bare percent sign is not valid
// percent-encoding, and a real library containing one killed a real crawl
// after 11,465 items - so the fake carries the shape that broke it.
const YEARS = ["2023", "2024 100% complete", "2025"];

const EXTENSIONS = ["docx", "xlsx", "pdf", "pptx", "msg", "csv"];

const PEOPLE = ["Ada Cooper", "Ben Ngata", "Chloe Marsh", "Dev Patel", "Erin Walsh"];

// Deterministic instead of random, so a re-crawl of an unchanged library
// really is unchanged. Math.random here would make every crawl look like
// the whole library had been rewritten.
function pseudo(index, span) {
  return (index * 2654435761) % span;
}

function isoAt(index, yearsAgo) {
  // Fixed epoch, not Date.now(), for the same determinism reason.
  const base = Date.UTC(2026, 0, 1) - yearsAgo * 365 * 24 * 60 * 60 * 1000;
  return new Date(base - pseudo(index, 200) * 24 * 60 * 60 * 1000).toISOString();
}

function folderPath(...segments) {
  return segments.length === 0
    ? `/drives/${DRIVE_ID}/root:`
    : `/drives/${DRIVE_ID}/root:/${segments.join("/")}`;
}

// -------------------------------------------------------------------
// The library, built once.
//
// A real shape: departments, year subfolders inside them, files inside
// those. Deep enough that depth and path parsing are actually exercised,
// and it includes the awkward cases on purpose - an empty folder, a folder
// holding one item, spaces in a name needing percent-encoding, and repeated
// content hashes so duplicate detection has something to find later.
// -------------------------------------------------------------------
function buildLibrary() {
  const items = [];

  // The root item itself. Real Graph sends it with no usable parent path,
  // so the parser stores NULL depth for it - worth including precisely
  // because it is the row most likely to be mishandled.
  items.push({
    id: "root",
    name: "root",
    folder: { childCount: DEPARTMENTS.length },
    parentReference: {},
  });

  DEPARTMENTS.forEach((department, d) => {
    const departmentId = `folder-dept-${d}`;

    items.push({
      id: departmentId,
      name: department,
      webUrl: `https://fake.sharepoint.com/sites/Finance/${encodeURIComponent(department)}`,
      createdDateTime: isoAt(d, 4),
      lastModifiedDateTime: isoAt(d, 1),
      // "Archive" is deliberately empty, and an empty folder is a finding
      // in its own right later on.
      folder: { childCount: department === "Archive" ? 0 : YEARS.length },
      parentReference: { id: "root", path: folderPath() },
      lastModifiedBy: { user: { displayName: PEOPLE[d % PEOPLE.length] } },
    });

    if (department === "Archive") return;

    YEARS.forEach((year, y) => {
      items.push({
        id: `folder-${d}-${y}`,
        name: year,
        webUrl: `https://fake.sharepoint.com/sites/Finance/${encodeURIComponent(department)}/${year}`,
        createdDateTime: isoAt(d + y, 3),
        lastModifiedDateTime: isoAt(d + y, 1),
        folder: { childCount: 0 },
        parentReference: { id: departmentId, path: folderPath(department) },
        lastModifiedBy: { user: { displayName: PEOPLE[(d + y) % PEOPLE.length] } },
      });
    });
  });

  // Files, spread across the year folders until the target is reached.
  let index = 0;

  while (items.length < TOTAL_ITEMS) {
    const d = index % (DEPARTMENTS.length - 1); // never Archive, it is empty
    const y = pseudo(index, YEARS.length);
    const department = DEPARTMENTS[d];
    const year = YEARS[y];
    const extension = EXTENSIONS[pseudo(index, EXTENSIONS.length)];

    items.push({
      id: `file-${index}`,
      name: `${department} report ${1000 + index}.${extension}`,
      size: 4096 + pseudo(index, 8_000_000),
      webUrl: `https://fake.sharepoint.com/sites/Finance/file-${index}.${extension}`,
      createdDateTime: isoAt(index, 3),
      lastModifiedDateTime: isoAt(index, pseudo(index, 3)),
      file: {
        hashes: {
          // Every seventeenth file shares a hash, so the inventory has real
          // duplicates in it rather than a uniformly clean library.
          quickXorHash:
            index % 17 === 0 ? "DUPLICATEHASHAAAAAAAAAAAA" : `HASH${String(index).padStart(20, "0")}`,
        },
      },
      parentReference: { id: `folder-${d}-${y}`, path: folderPath(department, year) },
      lastModifiedBy: { user: { displayName: PEOPLE[pseudo(index, PEOPLE.length)] } },
    });

    index += 1;
  }

  return items;
}

const LIBRARY = buildLibrary();
const TOTAL_PAGES = Math.ceil(LIBRARY.length / PAGE_SIZE);

// Fired at most once per server run, so a parked crawl actually resumes
// instead of parking forever.
let throttleSpent = false;

function send(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(payload);
}

function baseUrl() {
  return `http://localhost:${PORT}`;
}

// -------------------------------------------------------------------
// One page of the initial (full) walk.
// -------------------------------------------------------------------
function deltaPage(page) {
  const start = page * PAGE_SIZE;
  const value = LIBRARY.slice(start, start + PAGE_SIZE);
  const isLast = start + PAGE_SIZE >= LIBRARY.length;

  // Exactly one of the two links, never both - parseDeltaPage refuses a
  // page carrying both, so the fake must not produce one.
  return isLast
    ? { value, "@odata.deltaLink": `${baseUrl()}/drives/${DRIVE_ID}/root/delta?deltaToken=round2` }
    : { value, "@odata.nextLink": `${baseUrl()}/drives/${DRIVE_ID}/root/delta?page=${page + 1}` };
}

// -------------------------------------------------------------------
// An incremental walk, which is what a SECOND crawl of the same library
// gets. Small, and it carries the two things a full walk never shows: a
// tombstone, and a file that changed.
// -------------------------------------------------------------------
function incrementalPage() {
  const removed = LIBRARY.filter((item) => item.id.startsWith("file-")).slice(0, 3);
  const changed = LIBRARY.filter((item) => item.id.startsWith("file-")).slice(10, 14);

  return {
    value: [
      // Tombstones carry an id and almost nothing else, exactly as Graph
      // sends them.
      ...removed.map((item) => ({ id: item.id, deleted: { state: "deleted" } })),
      ...changed.map((item) => ({
        ...item,
        name: `${item.name.replace(/ \(revised\)/, "")} (revised)`,
        lastModifiedDateTime: new Date(Date.UTC(2026, 7, 26)).toISOString(),
      })),
      // A brand new file, so the incremental crawl adds as well as removes.
      {
        id: "file-new-arrival",
        name: "Board pack August.pdf",
        size: 2_400_000,
        webUrl: "https://fake.sharepoint.com/sites/Finance/board-pack.pdf",
        createdDateTime: new Date(Date.UTC(2026, 7, 26)).toISOString(),
        lastModifiedDateTime: new Date(Date.UTC(2026, 7, 26)).toISOString(),
        file: { hashes: { quickXorHash: "HASHNEWARRIVAL0000000000" } },
        parentReference: { id: "folder-0-0", path: folderPath("Finance", "2023") },
        lastModifiedBy: { user: { displayName: "Ada Cooper" } },
      },
    ],
    "@odata.deltaLink": `${baseUrl()}/drives/${DRIVE_ID}/root/delta?deltaToken=round3`,
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url, baseUrl());
  const path = decodeURIComponent(url.pathname);

  // The crawl sends a bearer on every request. The fake does not check it -
  // there is nothing here to protect - but a missing one means the client
  // is not building requests the way a real one would, so it is worth
  // saying rather than silently accepting.
  if (!request.headers.authorization?.startsWith("Bearer ")) {
    console.warn(`  no bearer token on ${path}`);
  }

  // ---- delta
  if (path === `/drives/${DRIVE_ID}/root/delta`) {
    const deltaToken = url.searchParams.get("deltaToken");
    const page = Number(url.searchParams.get("page") ?? 0);

    if (THROTTLE_PAGE !== null && !throttleSpent && page === THROTTLE_PAGE) {
      throttleSpent = true;
      const branch = RETRY_AFTER_SECONDS > 60 ? "crawl should PARK" : "client should wait and retry inline";
      console.log(`  page ${page}: answering 429, Retry-After ${RETRY_AFTER_SECONDS} (once) - ${branch}`);
      return send(
        response,
        429,
        { error: { code: "activityLimitReached" } },
        { "retry-after": String(RETRY_AFTER_SECONDS) },
      );
    }

    if (deltaToken) {
      console.log(`  incremental delta (token ${deltaToken})`);
      return send(response, 200, incrementalPage());
    }

    console.log(`  delta page ${page + 1} of ${TOTAL_PAGES}`);
    return send(response, 200, deltaPage(page));
  }

  // ---- the document libraries on a site
  if (path === `/sites/${SITE_ID}/drives`) {
    console.log("  drive list");
    return send(response, 200, {
      value: [
        {
          id: DRIVE_ID,
          name: "Documents",
          driveType: "documentLibrary",
          webUrl: "https://fake.sharepoint.com/sites/Finance/Shared%20Documents",
        },
        // A second drive that is NOT a document library, so the filter in
        // the service has something real to exclude.
        { id: "b!fake-drive-personal", name: "Personal", driveType: "personal" },
      ],
    });
  }

  // ---- a site, by path or as the tenant root
  if (path.startsWith("/sites/")) {
    console.log(`  site lookup ${path}`);
    return send(response, 200, {
      id: SITE_ID,
      displayName: "Finance (fake)",
      name: "Finance",
      webUrl: "https://fake.sharepoint.com/sites/Finance",
    });
  }

  console.log(`  404 ${path}`);
  return send(response, 404, { error: { code: "itemNotFound", message: `No fake route for ${path}` } });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Fake SharePoint is running.");
  console.log("");
  console.log(`    ${baseUrl()}`);
  console.log(`    ${LIBRARY.length} items, ${PAGE_SIZE} per page, ${TOTAL_PAGES} pages`);
  if (THROTTLE_PAGE !== null) {
    console.log(`    will answer 429 once on page ${THROTTLE_PAGE}, Retry-After ${RETRY_AFTER_SECONDS}`);
  }
  console.log("");
  console.log("  Put this in .env, then restart the dev server:");
  console.log("");
  console.log(`    DEV_FAKE_SHAREPOINT_URL=${baseUrl()}`);
  console.log("");
  console.log("  Then on /admin/sharepoint paste ANY https address, for example:");
  console.log("");
  console.log("    https://fake.sharepoint.com/sites/Finance");
  console.log("");
});
