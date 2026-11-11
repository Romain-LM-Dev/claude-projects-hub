import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoSecret, findSecret } from './secrets.ts';

const A = 'a'.repeat(40);
const cases: [string, string, string][] = [
  ['private-key', '-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN PUBLIC KEY-----'],
  ['anthropic-key', `sk-ant-${'x'.repeat(20)}`, `sk-ant-${'x'.repeat(19)}`],
  ['github-token', `ghp_${A.slice(0, 36)}`, `ghp_${A.slice(0, 35)}`],
  ['github-pat', `github_pat_${'A'.repeat(22)}`, `github_pat_${'A'.repeat(21)}`],
  ['aws-access-key', `AKIA${'0'.repeat(16)}`, `AKIA${'0'.repeat(15)}`],
  ['slack-token', 'xoxb-1234567890', 'xoxb-12345'],
];

for (const [name, pos, neg] of cases) {
  test(`secret ${name}`, () => {
    assert.equal(findSecret(`avant ${pos} après`), name);
    assert.equal(findSecret(`avant ${neg} après`), null);
  });
}

test('assertNoSecret throws secret_detected without echoing the secret', () => {
  assert.throws(() => assertNoSecret(`AKIA${'0'.repeat(16)}`), (e: any) => e.code === 'secret_detected' && !e.message.includes('AKIA0'));
  assertNoSecret('texte banal');
});
