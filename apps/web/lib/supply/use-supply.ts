'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdjustStockRequest,
  AllocateMaterialRequest,
  CreateDispatchRequest,
  CreateProductRequest,
  CreateProjectRequest,
  CreatePurchaseOrderRequest,
  CreateSupplierRequest,
  CreateWarehouseRequest,
  DeliverDispatchRequest,
  ReceivePurchaseOrderRequest,
  SetProjectStatusRequest,
  TransferStockRequest,
  UpdateMaterialRequest,
  UpdateProductRequest,
  UpsertCategoryRequest,
  UpsertMaterialRequest,
  UpsertUnitRequest,
} from '@aivoryx/contracts';
import * as api from '@/lib/api/supply';
import type {
  ListDispatchesParams,
  ListPosParams,
  ListProductsParams,
  ListProjectsParams,
  ListStockParams,
} from '@/lib/api/supply';

/** TanStack Query hooks for procurement, inventory & logistics (ADR 0034). */

export const supplyKeys = {
  units: ['supply', 'units'] as const,
  categories: ['supply', 'categories'] as const,
  products: (p: ListProductsParams) => ['supply', 'products', p] as const,
  suppliers: (q?: string) => ['supply', 'suppliers', q ?? ''] as const,
  warehouses: ['supply', 'warehouses'] as const,
  stock: (p: ListStockParams) => ['supply', 'stock', p] as const,
  movements: (p: Record<string, unknown>) => ['supply', 'movements', p] as const,
  projects: (p: ListProjectsParams) => ['supply', 'projects', p] as const,
  project: (id: string) => ['supply', 'project', id] as const,
  projectActivities: (id: string) => ['supply', 'project', id, 'activities'] as const,
  pos: (p: ListPosParams) => ['supply', 'pos', p] as const,
  po: (id: string) => ['supply', 'po', id] as const,
  dispatches: (p: ListDispatchesParams) => ['supply', 'dispatches', p] as const,
  dispatch: (id: string) => ['supply', 'dispatch', id] as const,
  dispatchAttachments: (id: string) => ['supply', 'dispatch', id, 'attachments'] as const,
};

// ---- catalog ------------------------------------------------------

export const useUnits = () => useQuery({ queryKey: supplyKeys.units, queryFn: api.listUnits });
export const useCategories = () =>
  useQuery({ queryKey: supplyKeys.categories, queryFn: api.listCategories });
export const useWarehouses = () =>
  useQuery({ queryKey: supplyKeys.warehouses, queryFn: api.listWarehouses });
export const useSuppliers = (q?: string) =>
  useQuery({ queryKey: supplyKeys.suppliers(q), queryFn: () => api.listSuppliers(q) });
export const useProducts = (p: ListProductsParams = {}) =>
  useQuery({ queryKey: supplyKeys.products(p), queryFn: () => api.listProducts(p) });

export function useUpsertUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UpsertUnitRequest) => api.upsertUnit(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyKeys.units }),
  });
}
export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UpsertCategoryRequest) => api.upsertCategory(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyKeys.categories }),
  });
}
export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateProductRequest) => api.createProduct(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'products'] }),
  });
}
export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: UpdateProductRequest) => api.updateProduct(id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'products'] }),
  });
}
export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateSupplierRequest) => api.createSupplier(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'suppliers'] }),
  });
}
export function useUpdateSupplier(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateSupplierRequest) => api.updateSupplier(id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'suppliers'] }),
  });
}
export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateWarehouseRequest) => api.createWarehouse(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyKeys.warehouses }),
  });
}
export function useUpdateWarehouse(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateWarehouseRequest) => api.updateWarehouse(id, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyKeys.warehouses }),
  });
}

// ---- inventory ---------------------------------------------------

export const useStock = (p: ListStockParams = {}) =>
  useQuery({ queryKey: supplyKeys.stock(p), queryFn: () => api.listStock(p) });
export const useMovements = (p: Record<string, unknown> = {}) =>
  useQuery({ queryKey: supplyKeys.movements(p), queryFn: () => api.listMovements(p) });

function useInvalidateInventory() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['supply', 'stock'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'movements'] }),
    ]);
}
export function useAdjustStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (b: AdjustStockRequest) => api.adjustStock(b),
    onSuccess: invalidate,
  });
}
export function useTransferStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (b: TransferStockRequest) => api.transferStock(b),
    onSuccess: invalidate,
  });
}

// ---- projects --------------------------------------------------

export const useProjects = (p: ListProjectsParams = {}) =>
  useQuery({ queryKey: supplyKeys.projects(p), queryFn: () => api.listProjects(p) });
export const useProject = (id: string) =>
  useQuery({ queryKey: supplyKeys.project(id), queryFn: () => api.getProject(id), enabled: !!id });
export const useProjectActivities = (id: string) =>
  useQuery({
    queryKey: supplyKeys.projectActivities(id),
    queryFn: () => api.listProjectActivities(id),
    enabled: !!id,
  });

function useInvalidateProject(id: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: supplyKeys.project(id) }),
      qc.invalidateQueries({ queryKey: supplyKeys.projectActivities(id) }),
      qc.invalidateQueries({ queryKey: ['supply', 'projects'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'stock'] }),
    ]);
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateProjectRequest) => api.createProject(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'projects'] }),
  });
}
export function useApproveProject(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({ mutationFn: () => api.approveProject(id), onSuccess: invalidate });
}
export function useSetProjectStatus(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({
    mutationFn: (b: SetProjectStatusRequest) => api.setProjectStatus(id, b),
    onSuccess: invalidate,
  });
}
export function useAddMaterial(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({
    mutationFn: (b: UpsertMaterialRequest) => api.addMaterial(id, b),
    onSuccess: invalidate,
  });
}
export function useUpdateMaterial(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({
    mutationFn: ({ materialId, body }: { materialId: string; body: UpdateMaterialRequest }) =>
      api.updateMaterial(id, materialId, body),
    onSuccess: invalidate,
  });
}
export function useRemoveMaterial(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({
    mutationFn: (materialId: string) => api.removeMaterial(id, materialId),
    onSuccess: invalidate,
  });
}
export function useAllocateMaterial(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({
    mutationFn: (b: AllocateMaterialRequest) => api.allocateMaterial(id, b),
    onSuccess: invalidate,
  });
}
export function useReleaseMaterial(id: string) {
  const invalidate = useInvalidateProject(id);
  return useMutation({
    mutationFn: (b: AllocateMaterialRequest) => api.releaseMaterial(id, b),
    onSuccess: invalidate,
  });
}

// ---- procurement ---------------------------------------------

export const usePurchaseOrders = (p: ListPosParams = {}) =>
  useQuery({ queryKey: supplyKeys.pos(p), queryFn: () => api.listPurchaseOrders(p) });
export const usePurchaseOrder = (id: string) =>
  useQuery({ queryKey: supplyKeys.po(id), queryFn: () => api.getPurchaseOrder(id), enabled: !!id });

function useInvalidatePo(id: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: supplyKeys.po(id) }),
      qc.invalidateQueries({ queryKey: ['supply', 'pos'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'stock'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'movements'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'project'] }),
    ]);
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreatePurchaseOrderRequest) => api.createPurchaseOrder(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'pos'] }),
  });
}
export function usePoTransition(id: string) {
  const invalidate = useInvalidatePo(id);
  return {
    submit: useMutation({ mutationFn: () => api.submitPurchaseOrder(id), onSuccess: invalidate }),
    approve: useMutation({ mutationFn: () => api.approvePurchaseOrder(id), onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: () => api.cancelPurchaseOrder(id), onSuccess: invalidate }),
  };
}
export function useReceivePurchaseOrder(id: string) {
  const invalidate = useInvalidatePo(id);
  return useMutation({
    mutationFn: (b: ReceivePurchaseOrderRequest) => api.receivePurchaseOrder(id, b),
    onSuccess: invalidate,
  });
}

// ---- logistics ---------------------------------------------

export const useDispatches = (p: ListDispatchesParams = {}) =>
  useQuery({ queryKey: supplyKeys.dispatches(p), queryFn: () => api.listDispatches(p) });
export const useDispatch = (id: string) =>
  useQuery({
    queryKey: supplyKeys.dispatch(id),
    queryFn: () => api.getDispatch(id),
    enabled: !!id,
  });
export const useDispatchAttachments = (id: string) =>
  useQuery({
    queryKey: supplyKeys.dispatchAttachments(id),
    queryFn: () => api.listDispatchAttachments(id),
    enabled: !!id,
  });

function useInvalidateDispatch(id: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: supplyKeys.dispatch(id) }),
      qc.invalidateQueries({ queryKey: ['supply', 'dispatches'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'stock'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'movements'] }),
      qc.invalidateQueries({ queryKey: ['supply', 'project'] }),
    ]);
}

export function useCreateDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateDispatchRequest) => api.createDispatch(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supply', 'dispatches'] }),
  });
}
export function useDispatchActions(id: string) {
  const invalidate = useInvalidateDispatch(id);
  return {
    cancel: useMutation({ mutationFn: () => api.cancelDispatch(id), onSuccess: invalidate }),
    send: useMutation({ mutationFn: () => api.sendDispatch(id), onSuccess: invalidate }),
    deliver: useMutation({
      mutationFn: (b: DeliverDispatchRequest) => api.deliverDispatch(id, b),
      onSuccess: invalidate,
    }),
  };
}
export function useUploadDispatchAttachment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadDispatchAttachment(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyKeys.dispatchAttachments(id) }),
  });
}
export function useDeleteDispatchAttachment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => api.deleteDispatchAttachment(id, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: supplyKeys.dispatchAttachments(id) }),
  });
}
