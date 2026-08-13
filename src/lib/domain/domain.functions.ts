import { createServerFn } from "@tanstack/react-start";
import type { DomainStatus } from "./expected";

/** Probe status DNS/HTTPS domain kustom dari sisi server (menghindari CORS). */
export const checkDomainStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<DomainStatus> => {
    const { probeDomain } = await import("./dns.server");
    return probeDomain();
  },
);