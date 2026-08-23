import { promises as dnsPromises } from "node:dns";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

/**
 * Returns ALL addresses for a hostname so the caller can reject the whole
 * destination when any record is unsafe (defends against mixed-record
 * DNS rebinding).
 */
export const defaultDnsResolver: DnsResolver = async (hostname) => {
  const records = await dnsPromises.lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return records.map((record) => ({
    address: record.address,
    family: record.family,
  }));
};
