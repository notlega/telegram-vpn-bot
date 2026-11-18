/**
 * thin Vultr API v2 client. Docs: https://www.vultr.com/api/
 */

const API_BASE = "https://api.vultr.com/v2";

/** Error raised for any non-successful Vultr API response */
export class VultrError extends Error {
  /**
   * @param status — HTTP status code returned by Vultr
   * @param detail — response body fragment (truncated to 500 characters)
   */
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Vultr API ${status}: ${detail}`);
    this.name = "VultrError";
  }
}

/** Subset of the Vultr instance object the bot relies on */
export interface VultrInstance {
  /** Instance id (SUBID) */
  id: string;

  /** Region id, for example `icn` */
  region: string;

  /** Plan id, for example `vc2-1c-1g` */
  plan: string;

  /** OS image id the instance was created from */
  os_id: number;

  /** Primary IPv4 address, `0.0.0.0` until assigned */
  main_ip: string;

  /** Instance label */
  label: string;

  /** Vultr lifecycle status, for example `active` */
  status: string;

  /** Power state: `running` once the box is up */
  power_status: string;

  /** Vultr health opinion, for example `ok` */
  server_status: string;

  /** Creation timestamp as reported by Vultr */
  date_created: string;
}

/** One entry from the OS image catalog */
export interface VultrOs {
  /** Image id to pass as `os_id` when creating an instance */
  id: number;

  /** Display name, for example `Debian 13 x64` */
  name: string;

  /** Architecture, for example `x64` */
  arch: string;
}

/** One entry from the plan catalog */
export interface VultrPlan {
  /** Plan id, for example `vc2-1c-1g` */
  id: string;

  /** Virtual CPU count */
  vcpu_count: number;

  /** Memory in megabytes */
  ram: number;

  /** Base monthly price in USD */
  monthly_cost: number;

  /** Regions where the plan can be deployed */
  regions: string[];
}

/** Payload accepted by `POST /instances` */
export interface CreateInstanceRequest {
  /** Region id */
  region: string;

  /** Plan id */
  plan: string;

  /** OS image id */
  os_id: number;

  /** Instance label shown in the Vultr console */
  label: string;

  /** Hostname assigned inside the guest */
  hostname?: string;

  /** Base64 encoded cloud-init script */
  user_data: string;

  /** Automatic backup toggle; the bot disables backups to keep the base price */
  backups?: "enabled" | "disabled";
}

/**
 * performs one authenticated request against the Vultr API
 *
 * @param token — Vultr API token
 * @param path — path and query string, for example `/instances?per_page=100`
 * @param init — additional fetch options; method and body live here
 * @returns the parsed JSON body, or `undefined` for 204 responses
 * @throws {VultrError} for any non-2xx response
 */
async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.text();
  if (!response.ok) {
    throw new VultrError(response.status, body.slice(0, 500));
  }

  return (body ? JSON.parse(body) : undefined) as T;
}

/**
 * creates a new instance
 *
 * @param token — Vultr API token
 * @param payload — region, plan, image and cloud-init script
 * @returns the freshly created instance, usually still installing
 * @throws {VultrError} when Vultr rejects the request
 */
export function createInstance(
  token: string,
  payload: CreateInstanceRequest,
): Promise<VultrInstance> {
  return request<{ instance: VultrInstance }>(token, "/instances", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((result) => result.instance);
}

/**
 * fetches one instance
 *
 * @param token — Vultr API token
 * @param id — instance id
 * @returns the instance, or `null` when it no longer exists
 * @throws {VultrError} for errors other than 404
 */
export async function getInstance(token: string, id: string): Promise<VultrInstance | null> {
  try {
    const result = await request<{ instance: VultrInstance }>(token, `/instances/${id}`);
    return result.instance;
  } catch (error) {
    if (error instanceof VultrError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * lists instances in the account (first 100)
 *
 * @param token — Vultr API token
 * @returns all instances visible to the token
 */
export async function listInstances(token: string): Promise<VultrInstance[]> {
  const result = await request<{ instances: VultrInstance[] }>(token, "/instances?per_page=100");
  return result.instances;
}

/**
 * destroys an instance. Billing stops once Vultr processes the request
 *
 * @param token — Vultr API token
 * @param id — instance id
 * @throws {VultrError} when Vultr rejects the request
 */
export async function destroyInstance(token: string, id: string): Promise<void> {
  await request<void>(token, `/instances/${id}`, { method: "DELETE" });
}

/**
 * lists the OS image catalog
 *
 * @param token — Vultr API token
 * @returns every image available to the account
 */
export async function listOs(token: string): Promise<VultrOs[]> {
  const result = await request<{ os: VultrOs[] }>(token, "/os");
  return result.os;
}

/**
 * lists the plan catalog
 *
 * @param token — Vultr API token
 * @returns up to 500 plans
 */
export async function listPlans(token: string): Promise<VultrPlan[]> {
  const result = await request<{ plans: VultrPlan[] }>(token, "/plans?per_page=500");
  return result.plans;
}

/**
 * picks the newest x64 image whose name starts with the configured family
 *
 * @param candidates — OS catalog from {@link listOs}
 * @param family — name prefix, for example `Debian`
 * @returns the newest match, or `undefined` when the family is absent
 */
export function pickOs(candidates: VultrOs[], family: string): VultrOs | undefined {
  const matching = candidates
    .filter((os) => os.name.toLowerCase().startsWith(family.toLowerCase()) && os.arch === "x64")
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  return matching[0];
}

/**
 * finds a plan by id
 *
 * @param candidates — plan catalog from {@link listPlans}
 * @param id — plan id to match
 * @returns the plan, or `undefined` when the id is unknown
 */
export function pickPlan(candidates: VultrPlan[], id: string): VultrPlan | undefined {
  return candidates.find((plan) => plan.id === id);
}
