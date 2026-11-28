/**
 * thin Linode API v4 client. docs: https://techdocs.akamai.com/linode-api/reference/api
 */

const API_BASE = "https://api.linode.com/v4";

/** error raised for any non-successful linode api response */
export class ProviderError extends Error {
  /**
   * @param status — http status code returned by linode
   * @param detail — response body fragment, truncated to 500 characters
   * @param method — http method of the failed call
   * @param path — api path of the failed call
   */
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly method: string,
    readonly path: string,
  ) {
    super(`linode api ${status} on ${method} ${path}: ${detail}`);

    this.name = "ProviderError";
  }
}

/** subset of the linode instance object the bot relies on */
export interface LinodeInstance {
  /** instance id */
  id: number;

  /** region id, for example `jp-tyo-3` */
  region: string;

  /** plan id, for example `g6-nanode-1` */
  type: string;

  /** image id, for example `linode/debian13` */
  image: string;

  /** instance label */
  label: string;

  /** lifecycle status: `provisioning`, `booting`, `running`, `offline` */
  status: string;

  /** assigned ipv4 addresses, primary first, empty until boot */
  ipv4: string[];

  /** creation timestamp */
  created: string;
}

/** one entry from the image catalogue, trimmed to what the guard needs */
export interface LinodeImage {
  /** image id, for example `linode/debian13` */
  id: string;

  /** display label */
  label: string;

  /** feature list; `cloud-init` means user data will run */
  capabilities: string[];
}

/** payload accepted by `POST /linode/instances` */
export interface CreateInstanceRequest {
  /** region id */
  region: string;

  /** plan id */
  type: string;

  /** image id */
  image: string;

  /** instance label */
  label: string;

  /** root password; generated per instance and never stored */
  root_pass: string;

  /** base64 encoded cloud-init script */
  metadata: { user_data: string };
}

/**
 * performs one authenticated request against the linode api
 *
 * @param token — linode api token
 * @param path — api path and query, for example `/linode/instances`
 * @param init — additional fetch options; method and body live here
 * @returns parsed json body
 * @throws {ProviderError} for any non-2xx response
 */
async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "telegram-vpn-bot/1.0",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();

  if (!response.ok) {
    throw new ProviderError(response.status, body.slice(0, 500), method, path);
  }

  return (body ? JSON.parse(body) : undefined) as T;
}

/**
 * creates a new instance
 *
 * @param token — linode api token
 * @param payload — region, type, image and cloud-init script
 * @returns the freshly created instance, usually still provisioning
 * @throws {ProviderError} when linode rejects the request
 */
export function createInstance(
  token: string,
  payload: CreateInstanceRequest,
): Promise<LinodeInstance> {
  return request<LinodeInstance>(token, "/linode/instances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * fetches one instance
 *
 * @param token — linode api token
 * @param id — instance id
 * @returns the instance, or `null` when it no longer exists
 * @throws {ProviderError} for errors other than 404
 */
export async function getInstance(token: string, id: number): Promise<LinodeInstance | null> {
  try {
    return await request<LinodeInstance>(token, `/linode/instances/${id}`);
  } catch (error) {
    if (error instanceof ProviderError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

/**
 * lists instances in the account, first page only
 *
 * @param token — linode api token
 * @returns up to 100 instances
 */
export async function listInstances(token: string): Promise<LinodeInstance[]> {
  const result = await request<{ data: LinodeInstance[] }>(
    token,
    "/linode/instances?page_size=100",
  );

  return result.data;
}

/**
 * destroys an instance. billing stops once linode processes the request
 *
 * @param token — linode api token
 * @param id — instance id
 * @throws {ProviderError} when linode rejects the request
 */
export async function destroyInstance(token: string, id: number): Promise<void> {
  await request<Record<string, never>>(token, `/linode/instances/${id}`, { method: "DELETE" });
}

/**
 * reboots a running instance. the disk is untouched, so the vless link and its
 * credentials keep working
 *
 * @param token — linode api token
 * @param id — instance id
 * @throws {ProviderError} when linode rejects the request
 */
export async function rebootInstance(token: string, id: number): Promise<void> {
  await request<Record<string, never>>(token, `/linode/instances/${id}/reboot`, {
    method: "POST",
  });
}

/** one entry from the plan catalogue, trimmed to the price the bot reports */
export interface LinodeType {
  /** plan id, for example `g6-nanode-1` */
  id: string;

  /** hourly price in us dollars */
  hourly: number;

  /** monthly price in us dollars, the billing cap */
  monthly: number;
}

/** raw shape of one entry from `GET /linode/types/{id}` */
interface LinodeTypeResponse {
  /** plan id */
  id: string;

  /** price object, in us dollars */
  price: { hourly: number; monthly: number };
}

/**
 * fetches one plan so the bot can report what servers cost
 *
 * @param token — linode api token
 * @param typeId — plan id, for example `g6-nanode-1`
 * @returns plan id and its hourly and monthly price
 * @throws {ProviderError} when linode rejects the request
 */
export async function getType(token: string, typeId: string): Promise<LinodeType> {
  const result = await request<LinodeTypeResponse>(token, `/linode/types/${typeId}`);

  return { id: result.id, hourly: result.price.hourly, monthly: result.price.monthly };
}

/**
 * fetches the image catalogue so the caller can confirm cloud-init support
 *
 * @param token — linode api token
 * @returns up to 500 images
 */
export async function listImages(token: string): Promise<LinodeImage[]> {
  const result = await request<{ data: LinodeImage[] }>(token, "/images?page_size=500");

  return result.data;
}

/**
 * looks up one image by id
 *
 * @param candidates — image catalogue from {@link listImages}
 * @param id — image id, for example `linode/debian13`
 * @returns the image, or `undefined` when the id is unknown
 */
export function pickImage(candidates: LinodeImage[], id: string): LinodeImage | undefined {
  return candidates.find((image) => image.id === id);
}
