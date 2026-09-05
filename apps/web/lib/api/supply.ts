import type {
  AdjustStockRequest,
  AllocateMaterialRequest,
  Category,
  CreateDispatchRequest,
  CreateProductRequest,
  CreateProjectRequest,
  CreatePurchaseOrderRequest,
  CreateSupplierRequest,
  CreateWarehouseRequest,
  DeliverDispatchRequest,
  Dispatch,
  DispatchAttachment,
  DispatchDetail,
  DispatchList,
  Product,
  ProductList,
  Project,
  ProjectActivity,
  ProjectDetail,
  ProjectList,
  PurchaseOrderDetail,
  PurchaseOrderList,
  ReceivePurchaseOrderRequest,
  SetProjectStatusRequest,
  StockLevel,
  StockLevelList,
  StockMovementList,
  Supplier,
  TransferStockRequest,
  Unit,
  UpdateMaterialRequest,
  UpdateProductRequest,
  UpdatePurchaseOrderRequest,
  UpsertCategoryRequest,
  UpsertMaterialRequest,
  UpsertUnitRequest,
  Warehouse,
} from '@aivoryx/contracts';
import { API_V1_PREFIX, type ApiErrorResponse } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch, ApiError } from './client';

/** Procurement, inventory & logistics API calls (ADR 0034). Server-authorized. */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const qs = (params: object): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>))
    if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- catalog ----------------------------------------------------

export const listUnits = () => apiFetch<Unit[]>('/inventory/units', { cache: 'no-store' });
export const upsertUnit = (b: UpsertUnitRequest) => apiFetch<Unit>('/inventory/units', json(b));
export const listCategories = () =>
  apiFetch<Category[]>('/inventory/categories', { cache: 'no-store' });
export const upsertCategory = (b: UpsertCategoryRequest) =>
  apiFetch<Category>('/inventory/categories', json(b));

export interface ListProductsParams {
  q?: string;
  categoryId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}
export const listProducts = (p: ListProductsParams = {}) =>
  apiFetch<ProductList>(`/inventory/products${qs(p)}`, { cache: 'no-store' });
export const getProduct = (id: string) =>
  apiFetch<Product>(`/inventory/products/${id}`, { cache: 'no-store' });
export const createProduct = (b: CreateProductRequest) =>
  apiFetch<Product>('/inventory/products', json(b));
export const updateProduct = (id: string, b: UpdateProductRequest) =>
  apiFetch<Product>(`/inventory/products/${id}`, json(b, 'PATCH'));

export const listSuppliers = (q?: string) =>
  apiFetch<Supplier[]>(`/inventory/suppliers${qs({ q })}`, { cache: 'no-store' });
export const createSupplier = (b: CreateSupplierRequest) =>
  apiFetch<Supplier>('/inventory/suppliers', json(b));
export const updateSupplier = (id: string, b: CreateSupplierRequest) =>
  apiFetch<Supplier>(`/inventory/suppliers/${id}`, json(b, 'PATCH'));

export const listWarehouses = () =>
  apiFetch<Warehouse[]>('/inventory/warehouses', { cache: 'no-store' });
export const createWarehouse = (b: CreateWarehouseRequest) =>
  apiFetch<Warehouse>('/inventory/warehouses', json(b));
export const updateWarehouse = (id: string, b: CreateWarehouseRequest) =>
  apiFetch<Warehouse>(`/inventory/warehouses/${id}`, json(b, 'PATCH'));

// ---- inventory ----------------------------------------------

export interface ListStockParams {
  warehouseId?: string;
  productId?: string;
  lowStock?: boolean;
  page?: number;
  pageSize?: number;
}
export const listStock = (p: ListStockParams = {}) =>
  apiFetch<StockLevelList>(`/inventory/stock${qs(p)}`, { cache: 'no-store' });
export const listMovements = (p: Record<string, unknown> = {}) =>
  apiFetch<StockMovementList>(`/inventory/movements${qs(p)}`, { cache: 'no-store' });
export const adjustStock = (b: AdjustStockRequest) =>
  apiFetch<StockLevel[]>('/inventory/adjustments', json(b));
export const transferStock = (b: TransferStockRequest) =>
  apiFetch<StockLevel[]>('/inventory/transfers', json(b));

// ---- projects --------------------------------------------

export interface ListProjectsParams {
  status?: string;
  q?: string;
  leadId?: string;
  page?: number;
  pageSize?: number;
}
export const listProjects = (p: ListProjectsParams = {}) =>
  apiFetch<ProjectList>(`/projects${qs(p)}`, { cache: 'no-store' });
export const getProject = (id: string) =>
  apiFetch<ProjectDetail>(`/projects/${id}`, { cache: 'no-store' });
export const listProjectActivities = (id: string) =>
  apiFetch<ProjectActivity[]>(`/projects/${id}/activities`, { cache: 'no-store' });
export const createProject = (b: CreateProjectRequest) =>
  apiFetch<ProjectDetail>('/projects', json(b));
export const approveProject = (id: string) =>
  apiFetch<ProjectDetail>(`/projects/${id}/approve`, json({}));
export const setProjectStatus = (id: string, b: SetProjectStatusRequest) =>
  apiFetch<ProjectDetail>(`/projects/${id}/status`, json(b));
export const addMaterial = (id: string, b: UpsertMaterialRequest) =>
  apiFetch<ProjectDetail>(`/projects/${id}/materials`, json(b));
export const updateMaterial = (id: string, materialId: string, b: UpdateMaterialRequest) =>
  apiFetch<ProjectDetail>(`/projects/${id}/materials/${materialId}`, json(b, 'PATCH'));
export const removeMaterial = (id: string, materialId: string) =>
  apiFetch<ProjectDetail>(`/projects/${id}/materials/${materialId}`, { method: 'DELETE' });
export const allocateMaterial = (id: string, b: AllocateMaterialRequest) =>
  apiFetch<ProjectDetail>(`/projects/${id}/materials/allocate`, json(b));
export const releaseMaterial = (id: string, b: AllocateMaterialRequest) =>
  apiFetch<ProjectDetail>(`/projects/${id}/materials/release`, json(b));

// ---- procurement ------------------------------------------

export interface ListPosParams {
  status?: string;
  supplierId?: string;
  projectId?: string;
  page?: number;
  pageSize?: number;
}
export const listPurchaseOrders = (p: ListPosParams = {}) =>
  apiFetch<PurchaseOrderList>(`/procurement/purchase-orders${qs(p)}`, { cache: 'no-store' });
export const getPurchaseOrder = (id: string) =>
  apiFetch<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}`, { cache: 'no-store' });
export const createPurchaseOrder = (b: CreatePurchaseOrderRequest) =>
  apiFetch<PurchaseOrderDetail>('/procurement/purchase-orders', json(b));
export const updatePurchaseOrder = (id: string, b: UpdatePurchaseOrderRequest) =>
  apiFetch<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}`, json(b, 'PATCH'));
export const submitPurchaseOrder = (id: string) =>
  apiFetch<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}/submit`, json({}));
export const approvePurchaseOrder = (id: string) =>
  apiFetch<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}/approve`, json({}));
export const cancelPurchaseOrder = (id: string) =>
  apiFetch<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}/cancel`, json({}));
export const receivePurchaseOrder = (id: string, b: ReceivePurchaseOrderRequest) =>
  apiFetch<PurchaseOrderDetail>(`/procurement/purchase-orders/${id}/receive`, json(b));

// ---- logistics --------------------------------------------

export interface ListDispatchesParams {
  status?: string;
  projectId?: string;
  warehouseId?: string;
  page?: number;
  pageSize?: number;
}
export const listDispatches = (p: ListDispatchesParams = {}) =>
  apiFetch<DispatchList>(`/logistics/dispatches${qs(p)}`, { cache: 'no-store' });
export const getDispatch = (id: string) =>
  apiFetch<DispatchDetail>(`/logistics/dispatches/${id}`, { cache: 'no-store' });
export const createDispatch = (b: CreateDispatchRequest) =>
  apiFetch<DispatchDetail>('/logistics/dispatches', json(b));
export const cancelDispatch = (id: string) =>
  apiFetch<DispatchDetail>(`/logistics/dispatches/${id}/cancel`, json({}));
export const sendDispatch = (id: string) =>
  apiFetch<DispatchDetail>(`/logistics/dispatches/${id}/dispatch`, json({}));
export const deliverDispatch = (id: string, b: DeliverDispatchRequest) =>
  apiFetch<DispatchDetail>(`/logistics/dispatches/${id}/deliver`, json(b));

// ---- dispatch delivery attachments (existing object storage, ADR 0015) ----

export const listDispatchAttachments = (id: string) =>
  apiFetch<DispatchAttachment[]>(`/logistics/dispatches/${id}/attachments`, { cache: 'no-store' });

export async function uploadDispatchAttachment(
  id: string,
  file: File,
): Promise<DispatchAttachment> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<DispatchAttachment>(`/logistics/dispatches/${id}/attachments`, {
    method: 'POST',
    body: form,
  });
}

export const deleteDispatchAttachment = (id: string, attachmentId: string) =>
  apiFetch<void>(`/logistics/dispatches/${id}/attachments/${attachmentId}`, { method: 'DELETE' });

/** Authenticated download → object URL. Caller must `URL.revokeObjectURL`. */
export async function fetchDispatchAttachmentBlob(
  id: string,
  attachmentId: string,
): Promise<{ blob: Blob; objectUrl: string }> {
  const url = `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/logistics/dispatches/${id}/attachments/${attachmentId}/download`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let body: ApiErrorResponse | undefined;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw new ApiError(res.status, body);
  }
  const blob = await res.blob();
  return { blob, objectUrl: URL.createObjectURL(blob) };
}

export type { Dispatch, Project, PurchaseOrderDetail as PoDetail };
