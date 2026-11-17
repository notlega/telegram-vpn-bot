/**
 * Thin Vultr API v2 client. Docs: https://www.vultr.com/api/
 */

const API_BASE = "https://api.vultr.com/v2";

export class VultrError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Vultr API ${status}: ${detail}`);
    this.name = "VultrError";
  }
}

export interface VultrInstance {
  id: string;
  region: string;
  plan: string;
  os_id: number;
  main_ip: string;
  label: string;
  status: string;
  power_status: string;
  server_status: string;
  date_created: string;
}

export interface VultrOs {
  id: number;
  name: string;
  arch: string;
}

export interface VultrPlan {
  id: string;
  vcpu_count: number;
  ram: number;
  monthly_cost: number;
  regions: string[];
}

export interface CreateInstanceRequest {
  region: string;
  plan: string;
  os_id: number;
  label: string;
  hostname?: string;
  user_data: string;
  backups?: "enabled" | "disabled";
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const body = await response.text();
  if (!response.ok) throw new VultrError(response.status, body.slice(0, 500));

  return (body ? JSON.parse(body) : undefined) as T;
}

export function createInstance(token: string, payload: CreateInstanceRequest): Promise<VultrInstance> {
  return request<{ instance: VultrInstance }>(token, "/instances", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((result) => result.instance);
}

export async function getInstance(token: string, id: string): Promise<VultrInstance | null> {
  try {
    const result = await request<{ instance: VultrInstance }>(token, `/instances/${id}`);
    return result.instance;
  } catch (error) {
    if (error instanceof VultrError && error.status === 404) return null;
    throw error;
  }
}

export async function listInstances(token: string): Promise<VultrInstance[]> {
  const result = await request<{ instances: VultrInstance[] }>(token, "/instances?per_page=100");
  return result.instances;
}

export async function destroyInstance(token: string, id: string): Promise<void> {
  await request<void>(token, `/instances/${id}`, { method: "DELETE" });
}

export async function listOs(token: string): Promise<VultrOs[]> {
  const result = await request<{ os: VultrOs[] }>(token, "/os");
  return result.os;
}

export async function listPlans(token: string): Promise<VultrPlan[]> {
  const result = await request<{ plans: VultrPlan[] }>(token, "/plans?per_page=500");
  return result.plans;
}

/** Picks the newest OS whose name starts with the configured family. */
export function pickOs(candidates: VultrOs[], family: string): VultrOs | undefined {
  const matching = candidates
    .filter((os) => os.name.toLowerCase().startsWith(family.toLowerCase()) && os.arch === "x64")
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  return matching[0];
}

export function pickPlan(candidates: VultrPlan[], id: string): VultrPlan | undefined {
  return candidates.find((plan) => plan.id === id);
}
