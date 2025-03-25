// src/services/n8nService.ts
import { v4 as uuidv4 } from 'uuid';
import { Message } from '@/types';
import { useStore, useSelectedAgents, useSelectedStrategy } from "@/store";

// Environment variables with fallbacks
const N8N_BASE_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:5678';

// Workflow endpoints from environment variables with fallbacks
const DEFAULT_WORKFLOW_ENDPOINT = process.env.NEXT_PUBLIC_N8N_DEFAULT_WORKFLOW || '/webhook/data-engineering-agent';
const OPENAI_WORKFLOW_ENDPOINT = process.env.NEXT_PUBLIC_N8N_OPENAI_WORKFLOW || '/webhook/data-engineering-agent';
const OLLAMA_WORKFLOW_ENDPOINT = process.env.NEXT_PUBLIC_N8N_OLLAMA_WORKFLOW || '/webhook/data-engineering-agent';
const CLAUDE_WORKFLOW_ENDPOINT = process.env.NEXT_PUBLIC_N8N_CLAUDE_WORKFLOW || '/webhook/data-engineering-agent';

// Define workflow endpoints mapping
const WORKFLOW_ENDPOINTS: Record<string, string> = {
  'default': DEFAULT_WORKFLOW_ENDPOINT,
  'openai': OPENAI_WORKFLOW_ENDPOINT,
  'ollama': OLLAMA_WORKFLOW_ENDPOINT,
  'claude': CLAUDE_WORKFLOW_ENDPOINT,
  'demo': DEFAULT_WORKFLOW_ENDPOINT // Fallback for demo mode
};

interface N8nRequestPayload {
  selectedAgentIds: string[];
  selectedStrategy: string;
  query: string;
}

interface N8nResponse {
  success: boolean;
  messages: Message[];
  status: 'in_progress' | 'completed';
  error?: string;
}

/**
 * Service to handle communication with n8n workflows
 */
export const n8nService = {
  /**
   * Get the appropriate workflow endpoint based on the workflow type
   */
  getWorkflowEndpoint(workflowType: string): string {
    return WORKFLOW_ENDPOINTS[workflowType] || WORKFLOW_ENDPOINTS.default;
  },

  /**
   * Submit a query to the n8n workflow or generate demo responses if useDemoMode is true
   */
  async submitQuery(
    selectedAgentIds: string[],
    strategyId: string,
    query: string,
    useDemoMode = false
  ): Promise<N8nResponse> {
    const { apiSettings } = useStore.getState();
    const { n8nWorkflowType = 'default' } = apiSettings;
    
    // If in demo mode, return demo responses
    if (useDemoMode) {
      return this.generateDemoResponses(selectedAgentIds, strategyId, query);
    }
    
    // Otherwise, try to use the real n8n service
    try {
      const payload: N8nRequestPayload = {
        selectedAgentIds,
        selectedStrategy: strategyId,
        query
      };

      // Get the appropriate workflow endpoint based on the current workflow type
      const workflowEndpoint = this.getWorkflowEndpoint(n8nWorkflowType);
      const apiUrl = `${N8N_BASE_URL}${workflowEndpoint}`;
      
      console.log(`Submitting query to n8n (${n8nWorkflowType}):`, payload);
      console.log(`Using endpoint: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`n8n API error (${response.status}): ${errorText}`);
      }

      // Parse the raw response
      const rawResult = await response.json();
      
      // Transform n8n response format to match expected format
      // The n8n response is an array of agent responses
      if (Array.isArray(rawResult)) {
        const now = new Date();
        const messages: Message[] = [];
        
        // Process agent responses
        rawResult.forEach((item, index) => {
          console.log('Processing n8n response item:', item);
          if (item.agentId && item.agentName && item.content) {
            // It's an agent response
            messages.push({
              id: uuidv4(),
              agentId: item.agentId,
              agentName: item.agentName,
              content: item.content,
              role: 'assistant',
              createdAt: new Date(now.getTime() + index * 100) // Stagger timestamps slightly
            });
          } else if (item.summary) {
            // It's a summary
            messages.push({
              id: uuidv4(),
              agentId: "coordinator",
              agentName: "Coordinator",
              agentAvatar: "🧠",
              agentColor: "#9333EA",
              content: item.summary,
              role: 'system',
              type: 'summary',
              createdAt: new Date(now.getTime() + rawResult.length * 100)
            });
          }
        });
        
        return {
          success: true,
          messages,
          status: 'completed'
        };
      }
      
      // If the response is already in the expected format
      const result = rawResult as N8nResponse;
      
      // Process timestamps to convert string dates to Date objects
      if (result.messages && Array.isArray(result.messages)) {
        result.messages = result.messages.map(message => {
          // Create a new message object with consistent fields
          return {
            ...message,
            id: message.id || uuidv4(),
            // Use timestamp field if available and convert to createdAt
            createdAt: message.timestamp ? new Date(message.timestamp) : 
                      (message.createdAt ? new Date(message.createdAt) : new Date())
          };
        });
      }
      
      return result;
    } catch (error) {
      console.error('Error submitting query to n8n:', error);
      
      // If there's an error with the real service, fall back to demo mode
      if (!useDemoMode) {
        console.log('Falling back to demo mode due to error');
        return this.generateDemoResponses(selectedAgentIds, strategyId, query);
      }
      
      return {
        success: false,
        messages: [
          {
            id: uuidv4(),
            content: `Error communicating with agent service: ${error instanceof Error ? error.message : 'Unknown error'}`,
            role: 'system',
            type: 'error',
            createdAt: new Date()
          }
        ],
        status: 'completed'
      };
    }
  },
  
  /**
   * Checks if the n8n service is available for the current workflow type
   * @returns A promise that resolves to true if the service is available
   */
  async checkAvailability(workflowType = 'default'): Promise<boolean> {
    try {
      // Use Next.js API route as a proxy to avoid CORS issues
      const response = await fetch(`/api/n8n/health/${workflowType}`, {
        method: 'GET'
      });
      
      if (!response.ok) {
        return false;
      }
      
      const result = await response.json();
      return result.available === true;
    } catch (error) {
      console.error(`n8n service (${workflowType}) is not available:`, error);
      return false;
    }
  },
  
  /**
   * Generates demo responses for when n8n is unavailable
   * @private
   */
  async generateDemoResponses(
    selectedAgentIds: string[],
    strategyId: string,
    query: string
  ): Promise<N8nResponse> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Generate demo responses based on selected agents
    const messages: Message[] = [];
    const now = new Date();
    
    const agentResponses: Record<string, { name: string, response: string }> = {
      "data-architect": {
        name: "Data Architect",
        response: `As a Data Architect, I recommend approaching ${query.toLowerCase()} with a clear focus on structure and scalability. Consider using a layered architecture with appropriate technologies for each layer: ingestion, processing, storage, and analytics. This ensures flexibility and maintainability as your requirements evolve.`
      },
      "pipeline-engineer": {
        name: "Pipeline Engineer",
        response: `For ${query.toLowerCase()}, I would design pipelines with both batch and streaming capabilities. Use Apache Airflow for orchestration, implement thorough monitoring with Prometheus, and ensure error handling with retry mechanisms and dead-letter queues. Well-designed pipelines should be idempotent, allowing for safe replays and recovery.`
      },
      "data-analyst": {
        name: "Data Analyst",
        response: `Looking at ${query.toLowerCase()} from an analysis perspective, we should consider the end-user needs. Make sure the data model is intuitive and well-documented. Include common aggregations in your design, implement caching for frequently accessed metrics, and optimize for query performance. Also, consider implementing self-service analytics tools.`
      },
      "data-scientist": {
        name: "Data Scientist",
        response: `The approach to ${query.toLowerCase()} should include considerations for ML workflows. Ensure feature extraction is modular, data lineage is tracked, and model training can be reproduced. Consider implementing a feature store and setting up A/B testing infrastructure to validate improvements in production.`
      },
      "data-governance": {
        name: "Governance Specialist",
        response: `When addressing ${query.toLowerCase()}, don't overlook governance aspects. Implement comprehensive data cataloging, data quality checks at each pipeline stage, access controls based on classification, and audit logging for compliance. Consider tools like Apache Atlas or other metadata management solutions.`
      },
      "data-engineer": {
        name: "Data Engineer",
        response: `From an implementation perspective, ${query.toLowerCase()} would benefit from containerized microservices, CI/CD pipelines, and robust error handling. I suggest using technologies like Apache Kafka, Spark Streaming, and cloud-native services to ensure optimal performance and reliability.`
      }
    };
    
    for (const agentId of selectedAgentIds) {
      if (agentResponses[agentId]) {
        messages.push({
          id: uuidv4(),
          agentId,
          agentName: agentResponses[agentId].name,
          content: agentResponses[agentId].response,
          role: "assistant",
          createdAt: new Date(now.getTime() + messages.length * 100)
        });
      }
    }
    
    // Add a summary message if multiple agents were involved
    if (selectedAgentIds.length > 1) {
      messages.push({
        id: uuidv4(),
        content: `The agents discussed approaches to ${query.toLowerCase()}, highlighting architectural considerations, implementation specifics, and integration points. Key takeaways include the importance of scalability, maintainability, and the selection of appropriate technologies for each layer of the solution.`,
        role: "system",
        type: "summary",
        createdAt: new Date(now.getTime() + messages.length * 100)
      });
    }
    
    return {
      success: true,
      messages,
      status: 'completed'
    };
  }
};