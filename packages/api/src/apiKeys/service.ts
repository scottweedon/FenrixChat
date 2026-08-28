import { createMethods } from '@librechat/data-schemas';
import { ResourceType, PermissionBits, hasPermissions } from 'librechat-data-provider';
import type {
  AgentApiKeyListItem,
  AgentApiKeyCreateResult,
  AllMethods,
  IUser,
} from '@librechat/data-schemas';
import type { Types } from 'mongoose';

export interface ApiKeyServiceDependencies {
  validateAgentApiKey: AllMethods['validateAgentApiKey'];
  createAgentApiKey: AllMethods['createAgentApiKey'];
  listAgentApiKeys: AllMethods['listAgentApiKeys'];
  deleteAgentApiKey: AllMethods['deleteAgentApiKey'];
  getAgentApiKeyById: AllMethods['getAgentApiKeyById'];
  findUser: (query: { _id: string | Types.ObjectId }) => Promise<IUser | null>;
}

export interface RemoteAgentAccessResult {
  hasAccess: boolean;
  permissions: number;
  agent: { _id: Types.ObjectId; [key: string]: unknown } | null;
  /** True when `agentId` matched more than one name-accessible agent and was rejected rather than guessed. */
  ambiguous?: boolean;
}

export class AgentApiKeyService {
  private deps: ApiKeyServiceDependencies;

  constructor(deps: ApiKeyServiceDependencies) {
    this.deps = deps;
  }

  async validateApiKey(apiKey: string): Promise<{
    userId: Types.ObjectId;
    keyId: Types.ObjectId;
  } | null> {
    return this.deps.validateAgentApiKey(apiKey);
  }

  async createApiKey(params: {
    userId: string | Types.ObjectId;
    name: string;
    expiresAt?: Date | null;
  }): Promise<AgentApiKeyCreateResult> {
    return this.deps.createAgentApiKey(params);
  }

  async listApiKeys(userId: string | Types.ObjectId): Promise<AgentApiKeyListItem[]> {
    return this.deps.listAgentApiKeys(userId);
  }

  async deleteApiKey(
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<boolean> {
    return this.deps.deleteAgentApiKey(keyId, userId);
  }

  async getApiKeyById(
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<AgentApiKeyListItem | null> {
    return this.deps.getAgentApiKeyById(keyId, userId);
  }

  async getUserFromApiKey(apiKey: string): Promise<IUser | null> {
    const keyValidation = await this.validateApiKey(apiKey);
    if (!keyValidation) {
      return null;
    }

    return this.deps.findUser({ _id: keyValidation.userId });
  }
}

export function createApiKeyServiceDependencies(
  mongoose: typeof import('mongoose'),
): ApiKeyServiceDependencies {
  const methods = createMethods(mongoose);
  return {
    validateAgentApiKey: methods.validateAgentApiKey,
    createAgentApiKey: methods.createAgentApiKey,
    listAgentApiKeys: methods.listAgentApiKeys,
    deleteAgentApiKey: methods.deleteAgentApiKey,
    getAgentApiKeyById: methods.getAgentApiKeyById,
    findUser: methods.findUser,
  };
}

export interface GetRemoteAgentPermissionsDeps {
  getEffectivePermissions: (params: {
    userId: string;
    role?: string;
    resourceType: ResourceType;
    resourceId: string | Types.ObjectId;
  }) => Promise<number>;
}

/** AGENT owners automatically have full REMOTE_AGENT permissions */
export async function getRemoteAgentPermissions(
  deps: GetRemoteAgentPermissionsDeps,
  userId: string,
  role: string | undefined,
  resourceId: string | Types.ObjectId,
): Promise<number> {
  const agentPerms = await deps.getEffectivePermissions({
    userId,
    role,
    resourceType: ResourceType.AGENT,
    resourceId,
  });

  if (hasPermissions(agentPerms, PermissionBits.SHARE)) {
    return PermissionBits.VIEW | PermissionBits.EDIT | PermissionBits.DELETE | PermissionBits.SHARE;
  }

  return deps.getEffectivePermissions({
    userId,
    role,
    resourceType: ResourceType.REMOTE_AGENT,
    resourceId,
  });
}

export async function checkRemoteAgentAccess(params: {
  userId: string;
  role?: string;
  agentId: string;
  getAgent: (query: {
    id: string;
  }) => Promise<{ _id: Types.ObjectId; [key: string]: unknown } | null>;
  /**
   * Fallback used only when `agentId` doesn't resolve as a real agent ID - lets a
   * friendly agent name (LibreChat's own display name, also returned as the `name`
   * field from GET /v1/models) work as the API's `model` value too. Needed because
   * OpenAI-compatible model-listing clients that lack a separate display-label field
   * (e.g. Langflow's live model discovery) have no choice but to echo back whatever
   * string they showed the user - so if that string is the friendly name, it must
   * resolve here rather than only the opaque `agent_...` ID.
   */
  getAgentsByName: (name: string) => Promise<Array<{ _id: Types.ObjectId; [key: string]: unknown }>>;
  getEffectivePermissions: (params: {
    userId: string;
    role?: string;
    resourceType: ResourceType;
    resourceId: string | Types.ObjectId;
  }) => Promise<number>;
}): Promise<RemoteAgentAccessResult> {
  const { userId, role, agentId, getAgent, getAgentsByName, getEffectivePermissions } = params;

  let agent = await getAgent({ id: agentId });

  if (!agent) {
    const candidates = await getAgentsByName(agentId);
    const accessible: typeof candidates = [];
    for (const candidate of candidates) {
      const candidatePerms = await getRemoteAgentPermissions(
        { getEffectivePermissions },
        userId,
        role,
        candidate._id,
      );
      if (hasPermissions(candidatePerms, PermissionBits.VIEW)) {
        accessible.push(candidate);
      }
    }

    if (accessible.length > 1) {
      // Never silently guess which agent was meant - ambiguous names must be
      // disambiguated by the caller (e.g. by using the specific agent ID).
      return { hasAccess: false, permissions: 0, agent: null, ambiguous: true };
    }
    if (accessible.length === 0) {
      return { hasAccess: false, permissions: 0, agent: null };
    }
    agent = accessible[0];
  }

  const permissions = await getRemoteAgentPermissions(
    { getEffectivePermissions },
    userId,
    role,
    agent._id,
  );

  const hasAccess = hasPermissions(permissions, PermissionBits.VIEW);

  return { hasAccess, permissions, agent };
}
