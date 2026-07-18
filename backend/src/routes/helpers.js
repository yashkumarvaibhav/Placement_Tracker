import { getBatchConfig } from '../batches.js';

export const resolveBatchKey = (batchKey) => getBatchConfig(batchKey).key;

export const withResolvedBatch = (req) => ({
  ...req.body,
  batch_key: req.body?.batch_key || resolveBatchKey(req.query.batch),
});
