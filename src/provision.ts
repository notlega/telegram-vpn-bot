import type { Env, InstanceRecord, Region } from "./env";
import { generateRealityKeyPair, generateShortId, generateUuid, randomHex } from "./keys";
import { saveInstance } from "./kv";
import {
  createInstance,
  type LinodeImage,
  type LinodeInstance,
  listImages,
  ProviderError,
  pickImage,
} from "./linode";
import { buildUserData, encodeUserData } from "./startup";

/** KV key caching the linode image catalogue */
const IMAGE_CACHE_KEY = "cache:images";

/** image catalogue cache lifetime in seconds */
const IMAGE_CACHE_TTL = 86_400;

/**
 * loads the linode image catalogue, preferring the kv cache
 *
 * only one configured image is ever checked and the catalogue changes rarely,
 * so the full response is cached for a day instead of fetched on every create
 *
 * @param env — worker bindings
 * @returns catalogue entries trimmed to id, label and capabilities
 */
async function loadImages(env: Env): Promise<LinodeImage[]> {
  const cached = await env.KV.get<LinodeImage[]>(IMAGE_CACHE_KEY, "json");

  if (cached) {
    return cached;
  }

  const images = await listImages(env.LINODE_API_TOKEN);
  await env.KV.put(IMAGE_CACHE_KEY, JSON.stringify(images), { expirationTtl: IMAGE_CACHE_TTL });
  return images;
}

/**
 * parses the `REGIONS` configuration string into region options
 *
 * @param env — worker bindings; only `REGIONS` is read
 * @returns regions in menu order; malformed entries are dropped
 */
export function parseRegions(env: Env): Region[] {
  return env.REGIONS.split(",")
    .map((entry) => entry.split(":"))
    .filter(
      (parts): parts is [string, string] =>
        parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]),
    )
    .map(([id, label]) => ({ id: id.trim(), label: label.trim() }));
}

/**
 * finds a region by id
 *
 * @param env — worker bindings
 * @param id — linode region id such as `jp-tyo-3`
 * @returns the region, or `undefined` when not configured
 */
export function findRegion(env: Env, id: string): Region | undefined {
  return parseRegions(env).find((region) => region.id === id);
}

/**
 * creates a linode instance and registers it for reconciliation
 *
 * generates a fresh key pair, uuid and short id, confirms the configured image
 * supports cloud-init, then submits the bootstrap script as user data
 *
 * @param env — worker bindings
 * @param publicUrl — origin of the deployed worker, used to build the callback
 * @param chatId — chat that should receive the status updates
 * @param messageId — status message the bot edits when the server is ready
 * @param region — region selected by the operator
 * @returns the newly stored instance record
 * @throws {Error} when the image is unknown or lacks cloud-init support, or
 *   linode refuses the request
 */
export async function provisionServer(
  env: Env,
  publicUrl: string,
  chatId: number,
  messageId: number,
  region: Region,
): Promise<InstanceRecord> {
  const images = await loadImages(env);
  const image = pickImage(images, env.IMAGE);

  if (!image) {
    throw new Error(`image "${env.IMAGE}" not found on linode`);
  }

  if (!image.capabilities.includes("cloud-init")) {
    throw new Error(`image "${env.IMAGE}" has no cloud-init support, user data would not run`);
  }

  let instance: LinodeInstance;
  const keys = await generateRealityKeyPair();
  const uuid = generateUuid();
  const shortId = generateShortId();
  const secret = randomHex(24);
  const userData = buildUserData({
    uuid,
    privateKey: keys.privateKey,
    shortId,
    sni: env.SNI,
    callbackUrl: `${publicUrl}/ready`,
    secret,
  });

  try {
    instance = await createInstance(env.LINODE_API_TOKEN, {
      region: region.id,
      type: env.TYPE,
      image: env.IMAGE,
      label: `vpn-${region.id}-${shortId}`,
      root_pass: randomHex(24),
      metadata: { user_data: encodeUserData(userData) },
    });
  } catch (error) {
    if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) {
      throw new Error("linode refused the request, check the api token scopes and account limits");
    }

    throw error;
  }

  const record: InstanceRecord = {
    id: String(instance.id),
    region: region.id,
    regionLabel: region.label,
    ip: instance.ipv4[0] ?? "pending",
    state: "provisioning",
    chatId,
    messageId,
    secret,
    uuid,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    shortId,
    sni: env.SNI,
    createdAt: Date.now(),
  };

  await saveInstance(env.KV, record);

  return record;
}

/**
 * renders the intermediate "creating server" chat message
 *
 * @param record — record stored right after the instance was created
 * @returns plain-text message body
 */
export function describeProvisioning(record: InstanceRecord): string {
  return [
    `🛠 creating ${record.regionLabel} server`,
    `instance: ${record.id}`,
    "",
    "installing Xray, this takes ~2 minutes",
    "i will post the link here when it answers",
  ].join("\n");
}
