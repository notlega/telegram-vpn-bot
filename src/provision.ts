import type { Env, InstanceRecord, Region } from "./env";
import { generateRealityKeyPair, generateShortId, generateUuid, randomHex } from "./keys";
import { saveInstance } from "./kv";
import { buildUserData, encodeUserData } from "./startup";
import { createInstance, listOs, listPlans, pickOs, pickPlan, VultrError } from "./vultr";

export function parseRegions(env: Env): Region[] {
  return env.REGIONS.split(",")
    .map((entry) => entry.split(":"))
    .filter((parts): parts is [string, string] => parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]))
    .map(([id, label]) => ({ id: id.trim(), label: label.trim() }));
}

export function findRegion(env: Env, id: string): Region | undefined {
  return parseRegions(env).find((region) => region.id === id);
}

export async function provisionServer(
  env: Env,
  publicUrl: string,
  chatId: number,
  messageId: number,
  region: Region,
): Promise<InstanceRecord> {
  const [osList, planList] = await Promise.all([listOs(env.VULTR_API_TOKEN), listPlans(env.VULTR_API_TOKEN)]);

  const os = pickOs(osList, env.OS_NAME);
  if (!os) throw new Error(`no OS matching "${env.OS_NAME}" (x64) on Vultr`);

  const plan = pickPlan(planList, env.PLAN);
  if (!plan) throw new Error(`plan "${env.PLAN}" not found on Vultr`);

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

  let instance;
  try {
    instance = await createInstance(env.VULTR_API_TOKEN, {
      region: region.id,
      plan: plan.id,
      os_id: os.id,
      label: `vpn-${region.id}-${shortId}`,
      hostname: `vpn-${region.id}-${shortId}`,
      user_data: encodeUserData(userData),
      backups: "disabled",
    });
  } catch (error) {
    if (error instanceof VultrError && error.status === 403) {
      throw new Error("Vultr refused the request (403) — check the API token permissions and account limits");
    }
    throw error;
  }

  const record: InstanceRecord = {
    id: instance.id,
    region: region.id,
    regionLabel: region.label,
    ip: instance.main_ip && instance.main_ip !== "0.0.0.0" ? instance.main_ip : "pending",
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

export function describeProvisioning(record: InstanceRecord): string {
  return [
    `🛠 Creating ${record.regionLabel} server`,
    `instance: ${record.id}`,
    "",
    "Installing Xray, this takes ~2 minutes.",
    "I will post the link here when it answers.",
  ].join("\n");
}
