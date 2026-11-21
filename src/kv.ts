import type { InstanceRecord } from "./env";

/** KV key prefix for instance records */
const INSTANCE_PREFIX = "inst:";

/** KV key prefix for the callback-token index */
const SECRET_PREFIX = "secret:";

/** KV key holding the ids of records still provisioning */
const PENDING_KEY = "pending";

/**
 * builds the KV key for one instance record
 *
 * @param id — linode instance id
 * @returns key in the form `inst:<id>`
 */
function instanceKey(id: string): string {
  return `${INSTANCE_PREFIX}${id}`;
}

/**
 * builds the KV key for the callback-token index
 *
 * @param secret — per-instance callback token
 * @returns key in the form `secret:<token>`
 */
function secretKey(secret: string): string {
  return `${SECRET_PREFIX}${secret}`;
}

/**
 * reads the ids of records still provisioning
 *
 * @param kv — KV binding
 * @returns ids in insertion order; empty when nothing is provisioning
 */
async function readPending(kv: KVNamespace): Promise<string[]> {
  return (await kv.get<string[]>(PENDING_KEY, "json")) ?? [];
}

/**
 * writes the provisioning index, deleting the key when the list empties
 *
 * @param kv — KV binding
 * @param ids — ids still provisioning
 */
async function writePending(kv: KVNamespace, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await kv.delete(PENDING_KEY);
    return;
  }

  await kv.put(PENDING_KEY, JSON.stringify(ids));
}

/**
 * persists an instance record together with its callback-token index entry
 *
 * keeps the provisioning index in sync so cron can skip a full KV list when
 * nothing is pending. The `secret:<token>` index exists only while the record
 * is provisioning; every later save deletes it, burning the token
 *
 * @param kv — KV binding
 * @param record — record to write; overwrites any previous copy
 */
export async function saveInstance(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  const pending = await readPending(kv);
  let next: string[];

  if (record.state === "provisioning") {
    next = pending.includes(record.id) ? pending : [...pending, record.id];
  } else {
    next = pending.filter((id) => id !== record.id);
  }

  const writes = [kv.put(instanceKey(record.id), JSON.stringify(record)), writePending(kv, next)];

  if (record.state === "provisioning") {
    writes.push(kv.put(secretKey(record.secret), record.id));
  } else {
    writes.push(kv.delete(secretKey(record.secret)));
  }

  await Promise.all(writes);
}

/**
 * reads an instance record
 *
 * @param kv — KV binding
 * @param id — linode instance id
 * @returns the record, or `null` when unknown
 */
export async function getInstance(kv: KVNamespace, id: string): Promise<InstanceRecord | null> {
  return kv.get<InstanceRecord>(instanceKey(id), "json");
}

/**
 * looks up an instance by the callback token a bootstrap script presents
 *
 * @param kv — KV binding
 * @param secret — callback token, valid only while the record is provisioning
 * @returns the record, or `null` when the token is unknown or burned
 */
export async function getInstanceBySecret(
  kv: KVNamespace,
  secret: string,
): Promise<InstanceRecord | null> {
  const id = await kv.get(secretKey(secret));

  if (!id) {
    return null;
  }

  return getInstance(kv, id);
}

/**
 * removes an instance record, its callback-token index entry and its
 * provisioning-index entry
 *
 * @param kv — KV binding
 * @param record — record being destroyed
 */
export async function deleteInstanceRecord(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  const pending = await readPending(kv);

  await Promise.all([
    kv.delete(instanceKey(record.id)),
    kv.delete(secretKey(record.secret)),
    writePending(
      kv,
      pending.filter((id) => id !== record.id),
    ),
  ]);
}

/**
 * lists the ids of records still provisioning
 *
 * @param kv — KV binding
 * @returns ids for {@link reconcile}; empty when nothing is pending
 */
export async function listPendingIds(kv: KVNamespace): Promise<string[]> {
  return readPending(kv);
}

/**
 * lists every tracked instance, oldest first
 *
 * handles KV pagination internally and skips index entries that no longer have
 * a body
 *
 * @param kv — KV binding
 * @returns all instance records sorted by creation time
 */
export async function listInstanceRecords(kv: KVNamespace): Promise<InstanceRecord[]> {
  const records: InstanceRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list<InstanceRecord>({ prefix: INSTANCE_PREFIX, cursor });

    for (const key of page.keys) {
      const record = await getInstance(kv, key.name.slice(INSTANCE_PREFIX.length));

      if (record) {
        records.push(record);
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records.sort((a, b) => a.createdAt - b.createdAt);
}
