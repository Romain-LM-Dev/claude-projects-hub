// Child process of store.test.ts: node store.child.ts <hubHome> <ref> <count> <tag>
import { appendTopic } from './store.ts';

const [hubHome, ref, count, tag] = process.argv.slice(2);
for (let i = 0; i < Number(count); i++) {
  await appendTopic({ hubHome }, ref, `${tag}-${i}`);
}
