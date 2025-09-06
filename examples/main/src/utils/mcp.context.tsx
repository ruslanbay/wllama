import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Client } from '../mcp/client/index.js';
import Ajv from 'ajv';
import { StreamableHTTPClientTransport } from '../mcp/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  LoggingMessageNotificationSchema,
  ResourceListChangedNotificationSchema,
  ElicitRequestSchema,
} from '../mcp/types.js';
import { MCP_SERVER_URL } from '../config';

interface MCPContextType {
  client: Client | null;
  transport: StreamableHTTPClientTransport | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  listTools: () => Promise<unknown>;
  listPrompts: () => Promise<unknown>;
  getPrompt: (name: string, args?: Record<string, string>) => Promise<unknown>;
  listResources: () => Promise<unknown>;
  readResource: (uri: string) => Promise<unknown>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  sessionId?: string | undefined;
}

const MCPContext = createContext<MCPContextType>({
  client: null,
  transport: null,
  isConnected: false,
  connect: async () => {},
  disconnect: async () => {},
  listTools: async () => ({}),
  listPrompts: async () => ({}),
  getPrompt: async () => ({}),
  listResources: async () => ({}),
  readResource: async () => ({}),
  callTool: async () => ({}),
});

export const MCPProvider = ({ children }: { children: ReactNode }) => {
  const [client, setClient] = useState<Client | null>(null);
  const [transport, setTransport] = useState<StreamableHTTPClientTransport | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [elicitationRequest, setElicitationRequest] = useState<any | null>(null);
  const [elicitationResolver, setElicitationResolver] = useState<((res: any) => void) | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  const connect = async () => {
    if (client) return;

    try {
      const newClient = new Client({ name: 'wllama-client', version: '1.0.0' }, { capabilities: { tools: { list: true, call: true }, elicitation: {} } });

      newClient.onerror = (error: unknown) => {
        console.error('MCP Client error:', error);
      };

      const newTransport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
        requestInit: { mode: 'cors', credentials: 'omit' },
        // use browser fetch explicitly when bundler allows tree-shaking
        fetch: (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : undefined,
      });

      newTransport.onclose = () => {
        setIsConnected(false);
        setSessionId(undefined);
      };
      newTransport.onerror = (err: unknown) => console.error('Transport error', err);

      // notification handlers
      newClient.setNotificationHandler(LoggingMessageNotificationSchema, (notification: any) => {
        console.log('MCP notification:', notification.params);
      });

  newClient.setNotificationHandler(ResourceListChangedNotificationSchema, async (_notification: any) => {
        try {
          const res = await newClient.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema);
          console.log('Resources changed, count:', (res as any).resources?.length ?? 0);
        } catch (e) {
          console.warn('Failed to list resources after notification', e);
        }
      });

      // Elicitation handler - show in-app modal and wait for user response
      newClient.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return await new Promise((resolve) => {
          setElicitationRequest(request);
          setElicitationResolver(() => (res: any) => {
            resolve(res);
            // clear after resolving
            setElicitationRequest(null);
            setElicitationResolver(null);
          });
        });
      });

      await newClient.connect(newTransport);

      setClient(newClient);
      setTransport(newTransport);
  setIsConnected(true);
  // session id may be set by the transport after initial request
  setSessionId(newTransport.sessionId);
    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      setClient(null);
      setTransport(null);
      setIsConnected(false);
    }
  };

  const disconnect = async () => {
    if (!transport) return;

    try {
      await transport.close();
      setClient(null);
      setTransport(null);
      setIsConnected(false);
    } catch (error) {
      console.error('Error disconnecting from MCP server:', error);
    }
  };

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listTools = async () => {
    if (!client) throw new Error('Not connected');
    return client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema as any);
  };

  const listPrompts = async () => {
    if (!client) throw new Error('Not connected');
    return client.request({ method: 'prompts/list', params: {} }, ListPromptsResultSchema as any);
  };

  const getPrompt = async (name: string, args: Record<string, string> = {}) => {
    if (!client) throw new Error('Not connected');
    return client.request({ method: 'prompts/get', params: { name, arguments: args } }, GetPromptResultSchema as any);
  };

  const listResources = async () => {
    if (!client) throw new Error('Not connected');
    return client.request({ method: 'resources/list', params: {} }, ListResourcesResultSchema as any);
  };

  const readResource = async (uri: string) => {
    if (!client) throw new Error('Not connected');
    return client.request({ method: 'resources/read', params: { uri } }, ReadResourceResultSchema as any);
  };

  const callTool = async (name: string, args: Record<string, unknown> = {}) => {
    if (!client) throw new Error('Not connected');
    return client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema as any);
  };

  return (
  <MCPContext.Provider value={{ client, transport, isConnected, connect, disconnect, listTools, listPrompts, getPrompt, listResources, readResource, callTool, sessionId }}>
      {children}

      {/* Minimal elicitation modal rendered inline; keep small and dependency-free */}
      {elicitationRequest && elicitationResolver ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
          <div className="bg-white rounded p-4 max-w-lg w-full">
            <div className="font-bold mb-2">{elicitationRequest.params?.message || 'Request information'}</div>
            <ElicitationForm
              schema={elicitationRequest.params?.requestedSchema}
              onSubmit={(content: any) => {
                elicitationResolver({ action: 'accept', content });
              }}
              onCancel={() => elicitationResolver({ action: 'cancel' })}
            />
          </div>
        </div>
      ) : null}
    </MCPContext.Provider>
  );
};

export const useMCP = () => useContext(MCPContext);

function ElicitationForm({ schema, onSubmit, onCancel }: { schema: any; onSubmit: (c: any) => void; onCancel: () => void }) {
  const properties = schema?.properties || {};
  const required: string[] = schema?.required || [];
  const [state, setState] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const k of Object.keys(properties)) {
      init[k] = properties[k].default ?? '';
    }
    return init;
  });

  const handleSubmit = () => {
    // validate with AJV
    try {
      const ajv = new Ajv();
      const validate = ajv.compile(schema || {});
      const ok = validate(state);
      if (ok) {
        onSubmit(state);
      } else {
        // if validation fails, still submit raw data (server may accept)
        onSubmit(state);
      }
    } catch (e) {
      onSubmit(state);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      {Object.entries(properties).map(([name, prop]: any) => (
        <div key={name} className="mb-3">
          <label className="block font-semibold">{prop.title || name}{required.includes(name) ? ' *' : ''}</label>
          <input className="w-full border rounded p-2" value={state[name] ?? ''} onChange={(e) => setState(prev => ({ ...prev, [name]: e.target.value }))} />
          {prop.description && <div className="text-sm text-gray-600">{prop.description}</div>}
        </div>
      ))}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Submit</button>
      </div>
    </form>
  );
}
