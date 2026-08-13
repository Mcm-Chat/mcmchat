/**
 * Nilai DNS yang diharapkan untuk domain kanonis MCM.
 * Client-safe: dipakai wizard verifikasi domain di Settings.
 */
import { SITE_HOST } from "@/lib/site";

export const DOMAIN_HOST = SITE_HOST;
export const WWW_HOST = `www.${SITE_HOST}`;
export const EXPECTED_A = "185.158.133.1";
export const LOVABLE_TXT_NAME = `_lovable.${SITE_HOST}`;
export const EXPECTED_TXT =
  "lovable_verify=2dafb2bd51dfbbb0f0d7f36dbb666ba1f00648c6194454fb4a01da073ec722d1";

export type DnsCheck = {
  /** Kunci stabil untuk render langkah wizard. */
  key: "ns" | "apex" | "www" | "txt" | "https";
  label: string;
  expected: string;
  found: string[];
  ok: boolean;
  hint: string;
};

export type DomainStatus = {
  host: string;
  checkedAt: string;
  checks: DnsCheck[];
  allOk: boolean;
};