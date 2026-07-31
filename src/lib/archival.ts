/**
 * Library of Congress archival photography client.
 *
 * Sources REAL public-domain photographs for HUVA slides instead of synthetic
 * imagery. For a Black-history brand, an authentic 1899 photograph of women
 * sorting tobacco in Richmond carries weight a generated "historical-looking"
 * image cannot, and it removes the risk of presenting fabricated material as
 * archival record.
 *
 * ── Which API ───────────────────────────────────────────────────────────────
 * Uses `loc.gov/photos/` rather than the older `loc.gov/pictures/` search.
 * Two reasons, both verified live:
 *   1. It honours the `fa=subject:...` facet, so results are constrained to
 *      LOC's own "African Americans" subject heading instead of relying on
 *      keyword overlap. `/pictures/` ignores the facet and returns Civil War
 *      generals, livestock prints and battlefield dead for the same query.
 *   2. It returns rights, medium, subject headings and sized derivatives INLINE,
 *      so a candidate is fully vetted from the search response with no per-item
 *      follow-up fetch.
 *
 * ── Rights posture (fail-closed) ────────────────────────────────────────────
 * Most of the catalog is NOT free to publish. Large holdings (the NAACP
 * records, the New York World-Telegram morgue) carry "Publication may be
 * restricted"; others were never evaluated. Only an explicit "no known
 * restrictions" passes. Silence is not permission.
 *
 * ── Editorial screening ─────────────────────────────────────────────────────
 * The catalog also holds a large body of 19th-century racist caricature and
 * minstrel material that WOULD satisfy a naive "are the subjects Black?" check.
 * Two defences: a metadata pre-screen here (single-photograph medium + a
 * caricature marker list), and `ARCHIVAL_AUDIT_RULES` below, which the caller
 * appends to the persona constraint when running the vision audit.
 *
 * ── Dating honesty ──────────────────────────────────────────────────────────
 * The catalog date travels with the image and is rendered in the on-slide
 * credit, so an illustrative pairing is always self-disclosing.
 *
 * No API key required. Keyless, unmetered, $0.
 */

/** Public-domain archival photograph ready to composite into a slide. */
export interface ArchivalImage {
    /** JPEG bytes of the largest usable derivative. */
    bytes: ArrayBuffer;
    /** Credit line rendered on the slide, including the catalog date. */
    credit: string;
    /** Catalog title, kept for asset metadata and logging. */
    title: string;
    /** loc.gov item page, recorded on the visual asset for provenance. */
    sourceUrl: string;
    /** Catalog date as printed, e.g. "[1899?]". */
    date: string | null;
    /** Verbatim rights statement that cleared this image. */
    rights: string;
}

const LOC_PHOTOS = 'https://www.loc.gov/photos/';
const UA = 'HistoryUnveiledVA-content-pipeline/1.0 (+https://faithandharmonyllc.com)';

/** Per-request ceiling. LOC is usually fast but occasionally stalls. */
const REQUEST_TIMEOUT_MS = 8_000;
/**
 * Candidates pulled per search. Deliberately wide: the single-photograph and
 * caricature filters reject most rows, so a narrow page yields nothing.
 */
const SEARCH_RESULTS = 25;
/** Global cap on distinct catalog searches per lookup. */
const MAX_QUERIES = 4;
/** Smallest derivative width worth compositing behind slide text. */
const MIN_WIDTH = 600;
/** LOC subject heading that scopes results to the brand's people. */
export const DEFAULT_SUBJECT_FACET = 'subject:african americans';

/**
 * Extra audit language applied to archival images on top of the persona subject
 * constraint.
 *
 * A racist caricature DOES depict Black figures, so "are the subjects Black?"
 * is the wrong question on its own. These rules make the vision audit reject
 * caricature, off-subject material and degrading imagery as well.
 */
export const ARCHIVAL_AUDIT_RULES = [
    'This is a historical archival photograph being considered for a Black-history publication.',
    'REJECT it if ANY of the following are true:',
    '- It is a racist caricature, minstrel image, or stereotyped/"comic" depiction of Black people.',
    '- It depicts primarily white subjects, officials, soldiers, or crowds.',
    '- It is not a photograph of people, places, work, or community life (for example: livestock, product studies, maps, blank documents, or pages of text).',
    '- It depicts violence, lynching, corpses, or degradation.',
    'ACCEPT only a dignified documentary photograph suitable for publication by a Black-history brand.',
].join('\n');

/**
 * Titles/subjects that mark 19th-century caricature and minstrel material.
 * A free pre-screen so this content never reaches the paid vision audit.
 */
const CARICATURE_MARKERS = new RegExp(
    [
        'minstrel', 'caricature', 'coon', 'darkey', 'darkie', 'pickaninny',
        'sambo', 'blackface', 'burlesque', 'tableaux', 'watermelon',
        'uncle tom', 'topsy', 'zip coon', 'comic', 'humorous', 'jolly',
        'lynch', 'corpse', 'dead', 'burial party', 'battle-field', 'battlefield',
    ].join('|'),
    'i',
);

/**
 * Subject vocabulary. Maps words in HUVA copy to terms the catalog indexes.
 * Narrative headline language ("grave robbers", "midnight riders") matches
 * nothing; catalog nouns match well.
 */
const SUBJECT_TERMS: Array<[RegExp, string]> = [
    [/\bcemeter|\bgrave|\bburial|\bundertaker|\bfuneral/i, 'cemetery'],
    [/\bhospital|\bclinic|\bnurse|\binfirmary/i, 'hospital'],
    [/\bphysician|\bdoctor|\bsurgeon|\bmedical/i, 'physician'],
    [/\bschool|\bteacher|\bpupil|\bstudent|\bacademy|\binstitute/i, 'school'],
    [/\bcollege|\buniversit/i, 'university'],
    [/\bchurch|\bcongregation|\bpastor|\bpreacher|\bminister/i, 'church'],
    [/\btobacco|\bcigar/i, 'tobacco'],
    [/\bfarm|\bfarmer|\bplanter|\bcrop|\bharvest|\bsharecrop|\bland/i, 'farm'],
    [/\bmill|\btextile|\bsilk|\bcotton|\bweav|\bsewing/i, 'mill'],
    [/\bfoundry|\biron|\bsteel|\bforge|\bblacksmith/i, 'blacksmith'],
    [/\boyster|\bfisher|\bwaterman|\bseafood|\bcrab/i, 'oyster'],
    [/\btimber|\blumber|\bsawmill|\bforest/i, 'lumber'],
    [/\brailroad|\brailway|\bporter|\btrain/i, 'railroad'],
    [/\bbank|\bbanker|\binsurance|\bsavings/i, 'bank'],
    [/\bstore|\bmerchant|\bgrocer|\bshop|\bbusiness/i, 'store'],
    [/\bbarber|\bbeaut/i, 'barber'],
    [/\bsoldier|\bregiment|\bveteran|\busct|\binfantry/i, 'soldiers'],
    [/\bmason|\blodge|\bfratern|\bbenevolent|\bsociety/i, 'lodge'],
    [/\bnewspaper|\beditor|\bprint|\bpress/i, 'newspaper'],
    [/\bhouse|\bhome|\bresidence|\bneighborhood|\bstreet/i, 'houses'],
];

/** Independent cities and frequently-referenced counties in HUVA's coverage. */
const VA_PLACES = [
    'richmond', 'petersburg', 'norfolk', 'danville', 'lynchburg', 'roanoke',
    'alexandria', 'charlottesville', 'fredericksburg', 'hampton', 'newport news',
    'portsmouth', 'staunton', 'winchester', 'suffolk', 'chesapeake', 'arlington',
    'williamsburg', 'farmville', 'harrisonburg', 'martinsville', 'bristol',
    'manassas', 'fairfax', 'salem', 'waynesboro', 'blacksburg', 'abingdon',
    'accomack', 'brunswick', 'mecklenburg', 'pittsylvania', 'halifax', 'floyd',
    'louisa', 'nottoway', 'amelia', 'southampton', 'dinwiddie', 'chesterfield',
    'henrico', 'goochland', 'buckingham', 'appomattox', 'campbell', 'bedford',
    'montgomery', 'augusta', 'rockbridge', 'rockingham', 'shenandoah', 'loudoun',
    'fauquier', 'stafford', 'spotsylvania', 'caroline', 'westmoreland',
    'gloucester', 'hanover', 'culpeper', 'albemarle', 'nelson', 'amherst',
    'charlotte', 'lunenburg', 'isle of wight', 'prince edward', 'prince george',
    'prince william', 'king william', 'new kent', 'charles city', 'wise',
];

/**
 * Build a search cascade for one topic, ordered most specific to most general.
 *
 * The subject facet already scopes results to African American material, so the
 * query text carries only subject and place. A single narrow query usually
 * misses, hence the cascade.
 */
export function buildArchivalQueries(...parts: Array<string | null | undefined>): string[] {
    const lower = parts.filter(Boolean).join(' ').toLowerCase();

    const subjects: string[] = [];
    for (const [pattern, term] of SUBJECT_TERMS) {
        if (pattern.test(lower) && !subjects.includes(term)) subjects.push(term);
        if (subjects.length >= 2) break;
    }

    let place = VA_PLACES.find(p => lower.includes(p)) ?? null;
    if (!place) {
        // "Pittsylvania County" style references not on the curated list.
        const county = lower.match(/\b([a-z]+)\s+county\b/);
        if (county) place = county[1];
    }

    const queries: string[] = [];
    const add = (q: string) => {
        const trimmed = q.replace(/\s+/g, ' ').trim();
        if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
    };

    for (const subject of subjects) {
        if (place) add(`${subject} ${place}`);
        add(`${subject} virginia`);
    }
    if (place) add(`${place} virginia`);
    add('virginia');

    return queries.slice(0, MAX_QUERIES);
}

/** fetch with a hard timeout so a stalled LOC request cannot hang the cron. */
async function locFetch(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

/** A `/photos/` search row. `item` carries the catalog record inline. */
interface LocPhotoResult {
    id?: string;
    title?: string;
    image_url?: string[];
    item?: {
        medium?: string | string[];
        medium_brief?: string | string[];
        rights_advisory?: string | string[];
        rights?: string | string[];
        reproduction_number?: string;
        call_number?: string;
        created_published_date?: string;
        subjects?: string[];
    };
}

const flatten = (v: string | string[] | null | undefined): string =>
    (Array.isArray(v) ? v.join(' ') : v ?? '').trim();

/**
 * Decide whether a rights statement clears the image for publication.
 *
 * Fail-closed by design: only an explicit "no known restrictions" (or an
 * outright public-domain declaration) passes. Blank statements, "rights status
 * not evaluated" and "publication may be restricted" are all rejections.
 */
export function isPubliclyUsable(rights: string | string[] | null | undefined): boolean {
    const text = flatten(rights).toLowerCase();
    if (!text) return false;
    if (/may be restricted|publication restricted|permission required|not been evaluated|not evaluated/.test(text)) {
        return false;
    }
    return /no known restrictions|no copyright restriction|public domain/.test(text);
}

/**
 * Accept only records describing exactly ONE photographic item.
 *
 * Verified against live catalog rows, this single rule removes lithographs and
 * political prints ("1 print :"), multi-item container records whose thumbnail
 * is an arbitrary member ("8 photographic prints ;", "120 photoprints :"), and
 * HABS/HAER documentation text ("Data Page(s): 21").
 */
export function isSinglePhotograph(medium: string | string[] | null | undefined): boolean {
    const text = flatten(medium).toLowerCase();
    if (!text) return false;
    return /^1\s+(photographic print|photograph|photoprint|photo)\b/.test(text);
}

/**
 * Free metadata pre-screen, applied before any download or vision spend.
 * Returns a rejection reason, or null when the record is usable.
 */
export function prescreen(result: LocPhotoResult): string | null {
    const item = result.item ?? {};
    if (!isSinglePhotograph(item.medium ?? item.medium_brief)) return 'not a single photograph';
    if (!isPubliclyUsable(item.rights_advisory ?? item.rights)) return 'rights not cleared';

    const haystack = [result.title ?? '', ...(item.subjects ?? [])].join(' ');
    if (CARICATURE_MARKERS.test(haystack)) return 'caricature/degrading marker';
    return null;
}

/**
 * Pick the widest derivative the search row offers.
 *
 * `/photos/` annotates each URL with its pixel size (`...v.jpg#h=807&w=1024`),
 * so the best candidate is chosen without probing. Group-of-images placeholder
 * SVGs and anything below MIN_WIDTH are skipped.
 */
export function largestDerivative(imageUrls: string[] | undefined): string | null {
    let best: { url: string; width: number } | null = null;
    for (const raw of imageUrls ?? []) {
        if (!/\.(jpg|jpeg)(\?|#|$)/i.test(raw)) continue;
        const width = Number(raw.match(/[#&]w=(\d+)/)?.[1] ?? 0);
        if (width < MIN_WIDTH) continue;
        if (!best || width > best.width) best = { url: raw.split('#')[0], width };
    }
    return best?.url ?? null;
}

/** Format the on-slide credit; the date makes an illustrative pairing self-disclosing. */
export function buildCredit(item: NonNullable<LocPhotoResult['item']>): string {
    const repro = (item.reproduction_number ?? '').trim();
    // "LC-USZ62-69316 (b&w film copy neg.)" → "LC-USZ62-69316"
    const id = repro ? repro.split(/\s*\(/)[0].trim() : (item.call_number ?? '').trim();
    const date = (item.created_published_date ?? '').trim().replace(/\.$/, '');
    return ['Library of Congress', id || null, date || null].filter(Boolean).join(' · ');
}

/** Download a derivative, rejecting HTML error pages served with a 200. */
async function fetchImage(url: string): Promise<ArrayBuffer | null> {
    try {
        const res = await locFetch(url);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 2));
        if (buf.byteLength > 8_000 && head[0] === 0xff && head[1] === 0xd8) return buf;
    } catch {
        // Fall through to null; the caller tries the next candidate.
    }
    return null;
}

async function search(query: string, facet: string): Promise<LocPhotoResult[]> {
    const url = `${LOC_PHOTOS}?q=${encodeURIComponent(query)}`
        + `&fa=${encodeURIComponent(facet)}&fo=json&c=${SEARCH_RESULTS}`;
    try {
        const res = await locFetch(url);
        if (!res.ok) return [];
        const data = (await res.json()) as { results?: LocPhotoResult[] };
        return data.results ?? [];
    } catch {
        return [];
    }
}

/**
 * Collect up to `count` distinct, rights-cleared, pre-screened photographs.
 *
 * Called ONCE per carousel rather than once per slide: a single search yields
 * the whole set, which keeps latency bounded and gives the carousel visual
 * variety instead of repeating one photograph across every slide.
 *
 * Returns fewer than `count` (possibly zero) when the catalog cannot supply
 * them. Callers fall through to the next ladder rung for the shortfall.
 */
export async function findArchivalImages(
    queries: string[],
    count: number,
    options?: { log?: (msg: string) => void; subjectFacet?: string },
): Promise<ArchivalImage[]> {
    const log = options?.log ?? (() => {});
    const facet = options?.subjectFacet ?? DEFAULT_SUBJECT_FACET;
    const found: ArchivalImage[] = [];
    const seen = new Set<string>();

    for (const query of queries) {
        if (found.length >= count) break;

        for (const result of await search(query, facet)) {
            if (found.length >= count) break;

            const id = result.id ?? '';
            if (!id || seen.has(id)) continue;
            seen.add(id);

            // The catalog holds many near-identical plates of the same scene
            // (e.g. three stereograph variants of "Filling their canteens").
            // Dedupe on the normalised title so one carousel does not run the
            // same photograph across several slides.
            const titleKey = (result.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (titleKey && seen.has(titleKey)) continue;
            if (titleKey) seen.add(titleKey);

            const rejected = prescreen(result);
            if (rejected) {
                log(`[archival] rejected (${rejected}): "${String(result.title).slice(0, 52)}"`);
                continue;
            }

            const url = largestDerivative(result.image_url);
            if (!url) continue;
            const bytes = await fetchImage(url);
            if (!bytes) continue;

            const item = result.item!;
            log(`[archival] cleared: "${String(result.title).slice(0, 52)}" (${item.created_published_date ?? 'n.d.'})`);
            found.push({
                bytes,
                credit: buildCredit(item),
                title: (result.title ?? 'Untitled').trim(),
                sourceUrl: id,
                date: item.created_published_date?.trim() || null,
                rights: flatten(item.rights_advisory ?? item.rights),
            });
        }
    }

    log(`[archival] ${found.length}/${count} images cleared`);
    return found;
}

/** Single-image convenience wrapper for thumbnails and video beats. */
export async function findArchivalImage(
    queries: string[],
    options?: { log?: (msg: string) => void; subjectFacet?: string },
): Promise<ArchivalImage | null> {
    const [first] = await findArchivalImages(queries, 1, options);
    return first ?? null;
}
