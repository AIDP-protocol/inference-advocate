import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Taxonomy } from '../src/monitor/taxonomy.js';
import { resolveEvaluator, discoverEvaluatorConfig } from '../src/monitor/evaluator-config.js';
import { openAdvocate } from '../src/setup.js';
import { dataPath } from './helpers.js';

const taxonomy = Taxonomy.loadFromFile(dataPath('taxonomy', 'flags.v0.json'));

test('no config means the rule evaluator, and it says so', () => {
  const resolved = resolveEvaluator({ taxonomy });
  assert.equal(resolved.evaluator.id, 'aidp-rule-evaluator');
  assert.equal(resolved.outboundContentPaths.length, 0);
  assert.ok(resolved.warnings.some((w) => w.includes('has no judgment')));
});

test('a hosted evaluator is reported as an outbound content path', () => {
  const resolved = resolveEvaluator({
    taxonomy,
    config: { kind: 'model', baseUrl: 'https://api.example.com/v1', model: 'm' },
  });
  assert.equal(resolved.evaluator.id, 'aidp-model-evaluator');
  assert.equal(resolved.outboundContentPaths.length, 1);
  assert.ok(resolved.outboundContentPaths[0]?.includes('api.example.com'));
  assert.ok(resolved.warnings.some((w) => w.includes('leaves this device')));
});

test('a local evaluator is not reported as outbound', () => {
  const resolved = resolveEvaluator({
    taxonomy,
    config: { kind: 'model', baseUrl: 'http://127.0.0.1:11434/v1', model: 'm' },
  });
  assert.equal(resolved.outboundContentPaths.length, 0);
  assert.equal(resolved.warnings.length, 0);
});

test('an evaluator served by a provider under evaluation is flagged as a self audit conflict', () => {
  const resolved = resolveEvaluator({
    taxonomy,
    config: { kind: 'model', baseUrl: 'https://api.example.com/v1', model: 'm' },
    providerBaseUrls: ['https://api.example.com/v1'],
  });
  assert.ok(resolved.warnings.some((w) => w.includes('SELF AUDIT CONFLICT')));
});

test('a config naming a key variable that is not set fails loudly rather than silently', () => {
  assert.throws(
    () =>
      resolveEvaluator({
        taxonomy,
        config: { kind: 'model', baseUrl: 'https://api.example.com/v1', model: 'm', apiKeyEnv: 'NOT_SET_ANYWHERE' },
        env: {},
      }),
    /NOT_SET_ANYWHERE/,
  );
});

test('the model evaluator flags a response against a live OpenAI-compatible endpoint', async () => {
  // A stand-in for a real evaluator endpoint. It speaks the wire format and returns the shape
  // an evaluator is asked for, which is what this test is checking the client half against.
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages: Array<{ content: string }>;
        temperature: number;
      };
      assert.equal(body.temperature, 0, 'decoding is pinned, because verdicts must be reproducible');
      const prompt = body.messages[0]?.content ?? '';
      assert.ok(prompt.includes('relational_hooks'), 'the taxonomy travels with the request');
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"flags":[{"type":"relational_hooks","evidence":["I care about you"],"reason":"cultivates dependence"}]}',
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  try {
    const { evaluator } = resolveEvaluator({
      taxonomy,
      config: { kind: 'model', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-evaluator' },
    });
    const flags = await evaluator.evaluate({
      providerId: 'p',
      content: 'Listen, I care about you, and I will be here waiting.',
    });
    assert.equal(flags.length, 1);
    assert.equal(flags[0]?.type, 'relational_hooks');
    assert.equal(flags[0]?.severity, 3, 'severity comes from the published taxonomy, not from the model');
    assert.equal(flags[0]?.evidence[0]?.text, 'I care about you');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('openAdvocate picks up an evaluator config and reports the outbound path in the export view', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aidp-eval-'));
  try {
    const configPath = join(dir, 'evaluator.json');
    writeFileSync(
      configPath,
      JSON.stringify({ kind: 'model', baseUrl: 'https://evaluator.example.com/v1', model: 'm' }),
    );
    assert.ok(discoverEvaluatorConfig(configPath));

    const opened = openAdvocate({
      dataDir: dataPath(),
      storePath: join(dir, 'advocate.sqlite'),
      evaluatorPath: configPath,
      devKeyfile: join(dir, 'dev.key'),
    });
    const view = opened.advocate.exportView('2000-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
    assert.equal(view.outboundContentPaths.length, 1);
    assert.ok(view.outboundContentPaths[0]?.includes('evaluator.example.com'));
    opened.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
