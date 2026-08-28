import { logger } from '@librechat/data-schemas';
import { ResourceType } from 'librechat-data-provider';
import type { Request, Response, NextFunction } from 'express';
import type { IUser } from '@librechat/data-schemas';
import type { Types } from 'mongoose';
import { checkRemoteAgentAccess } from './service';

export interface ApiKeyAuthDependencies {
  validateAgentApiKey: (apiKey: string) => Promise<{
    userId: Types.ObjectId;
    keyId: Types.ObjectId;
  } | null>;
  findUser: (query: { _id: string | Types.ObjectId }) => Promise<IUser | null>;
}

export interface RemoteAgentAccessDependencies {
  getAgent: (query: {
    id: string;
  }) => Promise<{ _id: Types.ObjectId; [key: string]: unknown } | null>;
  getAgentsByName: (name: string) => Promise<Array<{ _id: Types.ObjectId; [key: string]: unknown }>>;
  getEffectivePermissions: (params: {
    userId: string;
    role?: string;
    resourceType: ResourceType;
    resourceId: string | Types.ObjectId;
  }) => Promise<number>;
}

export interface ApiKeyAuthRequest extends Request {
  user?: IUser & { id: string };
  apiKeyId?: Types.ObjectId;
}

export interface RemoteAgentAccessRequest extends ApiKeyAuthRequest {
  agent?: { _id: Types.ObjectId; [key: string]: unknown };
  agentPermissions?: number;
}

export function createRequireApiKeyAuth(deps: ApiKeyAuthDependencies) {
  return async (
    req: ApiKeyAuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | undefined> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: 'Missing or invalid Authorization header. Expected: Bearer <api_key>',
          type: 'invalid_request_error',
          code: 'missing_api_key',
        },
      });
    }

    const apiKey = authHeader.slice(7);

    if (!apiKey || apiKey.trim() === '') {
      return res.status(401).json({
        error: {
          message: 'API key is required',
          type: 'invalid_request_error',
          code: 'missing_api_key',
        },
      });
    }

    try {
      const keyValidation = await deps.validateAgentApiKey(apiKey);

      if (!keyValidation) {
        return res.status(401).json({
          error: {
            message: 'Invalid API key',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
      }

      const user = await deps.findUser({ _id: keyValidation.userId });

      if (!user) {
        return res.status(401).json({
          error: {
            message: 'User not found for this API key',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
      }

      user.id = (user._id as Types.ObjectId).toString();
      req.user = user as IUser & { id: string };
      req.apiKeyId = keyValidation.keyId;

      next();
    } catch (error) {
      logger.error('[requireApiKeyAuth] Error validating API key:', error);
      return res.status(500).json({
        error: {
          message: 'Internal server error during authentication',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  };
}

export function createCheckRemoteAgentAccess(deps: RemoteAgentAccessDependencies) {
  return async (
    req: RemoteAgentAccessRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | undefined> => {
    const agentId = req.body?.model || req.params?.model;

    if (!agentId) {
      return res.status(400).json({
        error: {
          message: 'Model (agent ID) is required',
          type: 'invalid_request_error',
          code: 'missing_model',
        },
      });
    }

    try {
      const userId = req.user?.id || '';
      const { hasAccess, permissions, agent, ambiguous } = await checkRemoteAgentAccess({
        userId,
        role: req.user?.role,
        agentId,
        getAgent: deps.getAgent,
        getAgentsByName: deps.getAgentsByName,
        getEffectivePermissions: deps.getEffectivePermissions,
      });

      if (ambiguous) {
        return res.status(409).json({
          error: {
            message: `Multiple agents named "${agentId}" are accessible to you. Use the specific agent's ID instead.`,
            type: 'invalid_request_error',
            code: 'ambiguous_model_name',
          },
        });
      }

      if (!agent) {
        return res.status(404).json({
          error: {
            message: `Agent not found: ${agentId}`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        });
      }

      if (!hasAccess) {
        return res.status(403).json({
          error: {
            message: `No remote access to agent: ${agentId}`,
            type: 'permission_error',
            code: 'access_denied',
          },
        });
      }

      // The resolved agent's real ID may differ from what the caller sent (e.g. a
      // friendly name resolved via the getAgentsByName fallback above) - rewrite it
      // so every downstream reader (envelope construction, response `model` field,
      // etc.) sees the canonical ID exactly as if it had been sent directly.
      const resolvedId = (agent as { id?: string }).id;
      if (resolvedId && resolvedId !== agentId) {
        if (req.body && typeof req.body === 'object' && 'model' in req.body) {
          req.body.model = resolvedId;
        }
        if (req.params && 'model' in req.params) {
          req.params.model = resolvedId;
        }
      }

      req.agent = agent;
      req.agentPermissions = permissions;

      next();
    } catch (error) {
      logger.error('[checkRemoteAgentAccess] Error checking agent access:', error);
      return res.status(500).json({
        error: {
          message: 'Internal server error while checking agent access',
          type: 'server_error',
          code: 'internal_error',
        },
      });
    }
  };
}
