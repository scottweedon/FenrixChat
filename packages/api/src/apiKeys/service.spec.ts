import { Types } from 'mongoose';
import { PermissionBits } from 'librechat-data-provider';
import { checkRemoteAgentAccess } from './service';

/**
 * Tests for `checkRemoteAgentAccess`'s name-resolution fallback.
 *
 * Langflow's live model discovery (and any other OpenAI-compatible client without a
 * separate display-label field) can only echo back whatever string it showed the
 * user, so a friendly agent name must resolve here when the id lookup misses -
 * scoped to agents the caller can actually VIEW, and rejected as ambiguous rather
 * than guessed when more than one accessible agent shares that name.
 */
describe('checkRemoteAgentAccess', () => {
  const userId = new Types.ObjectId().toString();

  function makeAgent(overrides: Record<string, unknown> = {}) {
    return { _id: new Types.ObjectId(), id: 'agent_real_id', name: 'Sumo', ...overrides };
  }

  function makeDeps({
    agent,
    candidates = [],
    accessibleIds = new Set<string>(),
  }: {
    agent: Record<string, unknown> | null;
    candidates?: Array<Record<string, unknown>>;
    accessibleIds?: Set<string>;
  }) {
    const getAgent = jest.fn().mockResolvedValue(agent);
    const getAgentsByName = jest.fn().mockResolvedValue(candidates);
    const getEffectivePermissions = jest.fn().mockImplementation(({ resourceId }) =>
      Promise.resolve(
        accessibleIds.has(resourceId.toString()) ? PermissionBits.VIEW : 0,
      ),
    );
    return { getAgent, getAgentsByName, getEffectivePermissions };
  }

  it('resolves directly by id without consulting the name fallback', async () => {
    const agent = makeAgent();
    const deps = makeDeps({ agent, accessibleIds: new Set([agent._id.toString()]) });

    const result = await checkRemoteAgentAccess({
      userId,
      agentId: 'agent_real_id',
      ...deps,
    });

    expect(result.hasAccess).toBe(true);
    expect(result.agent).toBe(agent);
    expect(deps.getAgentsByName).not.toHaveBeenCalled();
  });

  it('falls back to a name match when the id lookup misses', async () => {
    const agent = makeAgent();
    const deps = makeDeps({
      agent: null,
      candidates: [agent],
      accessibleIds: new Set([agent._id.toString()]),
    });

    const result = await checkRemoteAgentAccess({
      userId,
      agentId: 'Sumo',
      ...deps,
    });

    expect(result.hasAccess).toBe(true);
    expect(result.agent).toBe(agent);
    expect(result.ambiguous).toBeUndefined();
  });

  it('rejects as ambiguous when more than one accessible agent shares the name', async () => {
    const agentA = makeAgent({ _id: new Types.ObjectId() });
    const agentB = makeAgent({ _id: new Types.ObjectId() });
    const deps = makeDeps({
      agent: null,
      candidates: [agentA, agentB],
      accessibleIds: new Set([agentA._id.toString(), agentB._id.toString()]),
    });

    const result = await checkRemoteAgentAccess({
      userId,
      agentId: 'Sumo',
      ...deps,
    });

    expect(result.ambiguous).toBe(true);
    expect(result.hasAccess).toBe(false);
    expect(result.agent).toBeNull();
  });

  it('does not treat a same-named agent the caller cannot view as ambiguous or accessible', async () => {
    const visible = makeAgent({ _id: new Types.ObjectId() });
    const hidden = makeAgent({ _id: new Types.ObjectId() });
    const deps = makeDeps({
      agent: null,
      candidates: [visible, hidden],
      accessibleIds: new Set([visible._id.toString()]),
    });

    const result = await checkRemoteAgentAccess({
      userId,
      agentId: 'Sumo',
      ...deps,
    });

    expect(result.ambiguous).toBeUndefined();
    expect(result.hasAccess).toBe(true);
    expect(result.agent).toBe(visible);
  });

  it('returns not-found when no candidate matches or is accessible', async () => {
    const deps = makeDeps({ agent: null, candidates: [] });

    const result = await checkRemoteAgentAccess({
      userId,
      agentId: 'Nonexistent',
      ...deps,
    });

    expect(result.agent).toBeNull();
    expect(result.hasAccess).toBe(false);
    expect(result.ambiguous).toBeUndefined();
  });

  it('never grants access to a name match the caller cannot view', async () => {
    const agent = makeAgent();
    const deps = makeDeps({ agent: null, candidates: [agent], accessibleIds: new Set() });

    const result = await checkRemoteAgentAccess({
      userId,
      agentId: 'Sumo',
      ...deps,
    });

    expect(result.hasAccess).toBe(false);
    expect(result.agent).toBeNull();
  });
});
