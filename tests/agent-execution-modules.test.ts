import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildExecutionContext } from '../src/app/api/agents/[agentId]/executions/context';
import { createPlatformExecutionExecutor } from '../src/app/api/agents/[agentId]/executions/platform-executor';
import type { AgentApproval } from '../src/lib/agent-platform/types';
import { createAgentRuntime, createPlatformToolAdapter, defaultAgentDefinitions, defaultToolDefinitions } from '../src/lib/agent-platform';
import type { PrismaClient } from '@prisma/client';
import { persistExecutionResult } from '../src/app/api/agents/[agentId]/executions/persistence';

const source = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('执行上下文不能被请求伪造租户、用户或运行时设置', () => {
  const context = buildExecutionContext(
    { id: 'actor', email: 'actor@example.test', name: '测试', role: 'owner', organizationId: 'org', organizationName: '隔离测试' },
    { workspaceId: 'workspace', accountId: 'account', marketplace: 'US' },
    { company: { organizationId: 'other' }, workspace: { workspaceId: 'other' }, user: { id: 'other' }, runtimeConfig: { secret: true }, currentData: { qty: 7 }, sku: 'SKU' },
    { ai: { enabled: false } },
  );
  assert.equal(context.company.organizationId, 'org');
  assert.equal(context.workspace.workspaceId, 'workspace');
  assert.equal(context.user.id, 'actor');
  assert.deepEqual(context.runtimeConfig, { ai: { enabled: false } });
  assert.deepEqual(context.historicalData, { qty: 7 });
});

for (const mode of ['normal', 'operator-approval', 'tool-approval'] as const) {
  test(`平台执行器保留 ${mode} 决策与审批行为`, async () => {
    let approvals = 0;
    const traces: string[] = [];
    const approval: AgentApproval = {
      id: 'approval', executionId: 'execution', status: 'REQUESTED', requestedAt: new Date().toISOString(),
      riskLevel: 'HIGH', recommendation: { summary: '测试审批', evidence: null, risks: [], confidence: 0.9, nextAction: '等待审批' },
      action: { type: 'platform.runtime.execute', target: 'platform-runtime-core', payload: {} },
    };
    const executor = createPlatformExecutionExecutor({ message: '  测试决策  ' }, 'platform-runtime-core', 'actor', 'snapshot', { key: 'value' }, mode === 'operator-approval');
    const result = await executor({
      execution: {
        id: 'execution', organizationId: 'org', agentDefinitionId: 'platform-runtime-core', workspaceId: 'workspace',
        accountId: 'account', marketplace: 'US', status: 'RUNNING', input: {},
        context: { company: { organizationId: 'org' }, workspace: { workspaceId: 'workspace' }, user: { id: 'actor' } },
        tokenUsage: 0, toolCallCount: 0, retryCount: 0, costCents: 0,
        createdAt: approval.requestedAt, updatedAt: approval.requestedAt,
      },
      definition: defaultAgentDefinitions.find(item => item.id === 'platform-runtime-core')!,
      context: { company: { organizationId: 'org' }, workspace: { workspaceId: 'workspace' }, user: { id: 'actor' } },
      callTool: async (toolId, input) => {
        assert.equal(toolId, 'snapshot'); assert.deepEqual(input, { key: 'value' });
        return mode === 'tool-approval' ? { status: 'APPROVAL_REQUIRED', approval } : { status: 'SUCCEEDED', output: { observed: true } };
      },
      requestApproval: async request => { approvals++; assert.equal(request.requestedByUserId, 'actor'); return approval; },
      recordTrace: type => traces.push(type), emitEvent: () => {},
    });
    assert.equal(result.recommendation?.summary, '测试决策');
    assert.equal((result.output as { state: string }).state, mode === 'normal' ? 'completed' : 'waiting_approval');
    assert.equal(approvals, mode === 'operator-approval' ? 1 : 0);
    assert.equal(result.tokenUsage, 0);
    assert.equal(result.costCents, 0);
    assert.deepEqual(traces, ['decision', 'recommendation']);
  });
}

test('本地平台快照实际执行不调用模型，用量为真实零值', async () => {
  const definition = defaultAgentDefinitions.find(item => item.id === 'platform-runtime-core')!;
  const runtime = createAgentRuntime({ definitions: [definition], tools: defaultToolDefinitions, adapters: [createPlatformToolAdapter()] });
  const result = await runtime.run({
    agentId: definition.id,
    context: { company: { organizationId: 'org' }, workspace: { workspaceId: 'workspace' }, user: { id: 'actor' } },
    input: {}, requestedByUserId: 'actor', workspaceId: 'workspace',
    executor: createPlatformExecutionExecutor({}, definition.id, 'actor', 'platform.context.snapshot', {}, false),
  });
  assert.equal(result.execution.status, 'COMPLETED');
  assert.equal(result.execution.tokenUsage, 0);
  assert.equal(result.execution.costCents, 0);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].toolId, 'platform.context.snapshot');
});

test('请求入口先授权，持久化成功后才结算积分且保留失败释放', async () => {
  const route = await source('src/app/api/agents/[agentId]/executions/route.ts');
  assert.ok(route.indexOf('requireApiPermission(') < route.indexOf('await request.json()'));
  assert.ok(route.indexOf('await persistExecutionResult(') < route.indexOf('await meter.settle('));
  assert.match(route, /if \(pointsMeter\?\.reserved\) await pointsMeter\.release\(\)/);
  assert.match(route, /verifyLaunchApproval/);
  assert.match(route, /body\.productContext = ppcHandoff\.payload\.productContext/);
});

test('执行持久化按原顺序保存任务和证据并保留查询隔离', async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const writes: string[] = [];
  const client: Record<string, unknown> = {};
  for (const entity of ['agentExecutionTrace', 'agentEvent', 'agentToolCall', 'agentApproval', 'agentMemory']) {
    client[entity] = { createMany: async ({ data }: { data: { organizationId: string }[] }) => {
      assert.equal(data[0].organizationId, 'org'); writes.push(entity);
    } };
  }
  client.agentExecution = {
    create: async ({ data }: { data: { id: string; organizationId: string } }) => { assert.equal(data.organizationId, 'org'); writes.push('execution'); return { id: data.id, status: 'COMPLETED' }; },
    update: async () => { writes.push('task-link'); },
    findMany: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { organizationId: 'org', agentDefinitionId: 'platform-runtime-core' }); return []; },
  };
  client.agentTask = { create: async () => { writes.push('task'); return { id: 'task' }; } };
  globals.prisma = client as unknown as PrismaClient;
  const now = new Date().toISOString();
  try {
    const result = await persistExecutionResult({
      execution: { id: 'execution', status: 'COMPLETED' }, traces: [{ id: 'trace', createdAt: now }],
      events: [{ id: 'event', createdAt: now }], toolCalls: [{ id: 'call' }], approvals: [{ id: 'approval', requestedAt: now }],
      memoryItems: [{ id: 'memory', createdAt: now, updatedAt: now }],
    } as Parameters<typeof persistExecutionResult>[0], { id: 'platform-runtime-core', name: '平台' } as Parameters<typeof persistExecutionResult>[1],
    { id: 'actor', organizationId: 'org' }, { workspaceId: 'workspace', accountId: 'account', marketplace: 'US' }, {});
    assert.equal(result.execution.taskId, 'task');
    assert.deepEqual(writes, ['execution', 'task', 'task-link', 'agentExecutionTrace', 'agentEvent', 'agentToolCall', 'agentApproval', 'agentMemory']);
    (client.agentExecution as { create: () => Promise<never> }).create = async () => { throw new Error('隔离持久化失败'); };
    await assert.rejects(persistExecutionResult({ execution: { id: 'failed' } } as Parameters<typeof persistExecutionResult>[0],
      { id: 'platform-runtime-core' } as Parameters<typeof persistExecutionResult>[1], { id: 'actor', organizationId: 'org' },
      { workspaceId: 'workspace', accountId: 'account', marketplace: 'US' }, {}), /隔离持久化失败/);
  } finally { globals.prisma = previous; }
});

test('持久化模块保留全部执行证据与组织隔离', async () => {
  const persistence = await source('src/app/api/agents/[agentId]/executions/persistence.ts');
  for (const entity of ['agentExecution', 'agentTask', 'agentExecutionTrace', 'agentEvent', 'agentToolCall', 'agentApproval', 'agentMemory']) {
    assert.match(persistence, new RegExp(`prisma\\.${entity}\\.`));
  }
  assert.match(persistence, /organizationId: user\.organizationId, agentDefinitionId: definition\.id/);
  assert.match(persistence, /redactedPayload/);
  assert.match(persistence, /redactedInput/);
});
