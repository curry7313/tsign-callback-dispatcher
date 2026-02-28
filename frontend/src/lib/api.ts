import axios from 'axios';
import { DispatchConfig, TagDefinition, OperationLog, TSignConfig, ApiResponse } from '../types/api.types';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.message);
    return Promise.reject(error);
  }
);

// Callbacks
export async function fetchCallbacks(): Promise<DispatchConfig[]> {
  const res = await api.get<ApiResponse<DispatchConfig[]>>('/callbacks');
  return res.data.data || [];
}

export async function fetchCallback(id: string): Promise<DispatchConfig> {
  const res = await api.get<ApiResponse<DispatchConfig>>(`/callbacks/${id}`);
  return res.data.data!;
}

export async function createCallback(data: Partial<DispatchConfig>): Promise<DispatchConfig> {
  const res = await api.post<ApiResponse<DispatchConfig>>('/callbacks', data);
  return res.data.data!;
}

export async function updateCallback(id: string, data: Partial<DispatchConfig>): Promise<DispatchConfig> {
  const res = await api.put<ApiResponse<DispatchConfig>>(`/callbacks/${id}`, data);
  return res.data.data!;
}

export async function deleteCallback(id: string): Promise<void> {
  await api.delete(`/callbacks/${id}`);
}

// Tags
export async function fetchTags(): Promise<TagDefinition[]> {
  const res = await api.get<ApiResponse<TagDefinition[]>>('/tags');
  return res.data.data || [];
}

export async function createTag(data: Partial<TagDefinition>): Promise<TagDefinition> {
  const res = await api.post<ApiResponse<TagDefinition>>('/tags', data);
  return res.data.data!;
}

export async function updateTag(id: string, data: Partial<TagDefinition>): Promise<TagDefinition> {
  const res = await api.put<ApiResponse<TagDefinition>>(`/tags/${id}`, data);
  return res.data.data!;
}

export async function deleteTag(id: string): Promise<void> {
  await api.delete(`/tags/${id}`);
}

// Logs & Stats
export async function fetchLogs(limit = 100, offset = 0): Promise<{ logs: OperationLog[]; total: number }> {
  const res = await api.get<ApiResponse<{ logs: OperationLog[]; total: number }>>('/logs', { params: { limit, offset } });
  return res.data.data || { logs: [], total: 0 };
}

// Health
export async function fetchHealth(): Promise<any> {
  const res = await api.get('/health');
  return res.data;
}

// Generate Keys
export async function generateKeys(): Promise<{ encryptKey: string; signToken: string }> {
  const res = await api.get<ApiResponse<{ encryptKey: string; signToken: string }>>('/callbacks/generate-keys');
  return res.data.data!;
}

// TSign Config
export async function fetchTSignConfig(): Promise<TSignConfig> {
  const res = await api.get<ApiResponse<TSignConfig>>('/tsign-config');
  return res.data.data || { encryptKey: '', token: '' };
}

export async function updateTSignConfig(data: TSignConfig): Promise<void> {
  await api.put('/tsign-config', data);
}
