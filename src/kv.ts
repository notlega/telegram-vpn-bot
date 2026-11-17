import type { InstanceRecord } from "./env";

const INSTANCE_PREFIX = "inst:";
const SECRET_PREFIX = "secret:";

function instanceKey(id: string): string {
  return `${INSTANCE_PREFIX}${id}`;
}

function secretKey(secret: string): string {
  return `${SECRET_PREFIX}${secret}`;
}

export async function saveInstance(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  await Promise.all([
    kv.put(instanceKey(record.id), JSON.stringify(record)),
    kv.put(secretKey(record.secret), record.id),
  ]);
}

export async function getInstance(kv: KVNamespace, id: string): Promise<InstanceRecord | null> {
  return kv.get<InstanceRecord>(instanceKey(id), "json");
}

export async function getInstanceBySecret(
  kv: KVNamespace,
  secret: string,
): Promise<InstanceRecord | null> {
  const id = await kv.get(secretKey(secret));
  if (!id) return null;
  return getInstance(kv, id);
}

export async function deleteInstanceRecord(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  await Promise.all([kv.delete(instanceKey(record.id)), kv.delete(secretKey(record.secret))]);
}

export async function listInstanceRecords(kv: KVNamespace): Promise<InstanceRecord[]> {
  const records: InstanceRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list<InstanceRecord>({ prefix: INSTANCE_PREFIX, cursor });
    for (const key of page.keys) {
      const record = await getInstance(kv, key.name.slice(INSTANCE_PREFIX.length));
      if (record) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records.sort((a, b) => a.createdAt - b.createdAt);
}
