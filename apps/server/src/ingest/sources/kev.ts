import type { D1LikeDatabase, D1Statement } from "../../db/adapter";
/**
 * CISA Known Exploited Vulnerabilities (KEV) catalog. Tells us which CVEs
 * are being actively exploited in the wild — the strongest signal an agent
 * can have for "refuse this immediately".
 *
 * Source: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 * JSON feed: https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 * Updated daily by CISA. ~1.5K entries as of mid-2026.
 */

const KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

interface KevApiEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
}

interface KevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: KevApiEntry[];
}

export interface KevRefreshResult {
  fetched: number;
  upserted: number;
}

export async function refreshKev(db: D1LikeDatabase): Promise<KevRefreshResult> {
  const res = await fetch(KEV_URL, {});
  if (!res.ok) throw new Error(`KEV fetch ${res.status}`);
  const catalog = (await res.json()) as KevCatalog;
  const entries = catalog.vulnerabilities ?? [];
  if (entries.length === 0) return { fetched: 0, upserted: 0 };

  const upsertSql = `
    INSERT INTO kev (
      cve_id, vendor_project, product, short_description,
      date_added, due_date, ransomware_use, required_action, notes,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(cve_id) DO UPDATE SET
      vendor_project   = excluded.vendor_project,
      product          = excluded.product,
      short_description = excluded.short_description,
      date_added       = excluded.date_added,
      due_date         = excluded.due_date,
      ransomware_use   = excluded.ransomware_use,
      required_action  = excluded.required_action,
      notes            = excluded.notes,
      fetched_at       = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `;

  // Chunk into D1 batches (~50 stmts each — well below the parameter cap).
  const CHUNK = 50;
  let upserted = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const stmts: D1Statement[] = [];
    for (const e of entries.slice(i, i + CHUNK)) {
      stmts.push(
        db
          .prepare(upsertSql)
          .bind(
            e.cveID,
            e.vendorProject ?? null,
            e.product ?? null,
            (e.shortDescription ?? "").slice(0, 2000),
            e.dateAdded,
            e.dueDate ?? null,
            (e.knownRansomwareCampaignUse ?? "").toLowerCase() === "known" ? 1 : 0,
            (e.requiredAction ?? "").slice(0, 1000),
            (e.notes ?? "").slice(0, 1000),
          ),
      );
    }
    await db.batch(stmts);
    upserted += stmts.length;
  }
  return { fetched: entries.length, upserted };
}
