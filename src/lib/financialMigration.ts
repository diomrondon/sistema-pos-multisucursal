/**
 * Dry-run analysis for historical financial records.
 * This module NEVER writes to LocalStorage, Firestore, or the input objects.
 * It only reports records that can be linked unambiguously and those needing review.
 */
type BranchId = number;

interface SaleSource {
  id: number;
  sucursal_id: BranchId;
  registroId?: string;
}
interface PurchaseSource {
  id: number;
  sucursalId: BranchId;
  proveedorId: number;
  numeroFactura?: string;
  registroId?: string;
}
interface ReceivableSource {
  id: number;
  ventaId?: number;
  sucursalId?: BranchId;
  registroId?: string;
  abonos?: Array<{ id: number; registroId?: string }>;
}
interface PayableSource {
  id: number;
  compraId?: number;
  sucursalId?: BranchId;
  proveedorId: number;
  numeroFactura: string;
  registroId?: string;
  pagos?: Array<{ id: number; registroId?: string }>;
}
export interface FinancialMigrationInput {
  ventas: SaleSource[];
  compras: PurchaseSource[];
  cxc: ReceivableSource[];
  cxp: PayableSource[];
}
export interface MigrationFinding {
  tipo: 'venta' | 'compra' | 'cxc' | 'cxp' | 'abono' | 'pago';
  idInterno: number;
  registroId?: string;
  estado: 'conservar' | 'asociacion_segura' | 'revision_manual';
  sucursalId?: number;
  referencia?: string;
  motivo: string;
}
export interface FinancialMigrationReport {
  soloLectura: true;
  resumen: { conservar: number; asociacionSegura: number; revisionManual: number };
  registros: MigrationFinding[];
}

const hasStableId = (value?: string): boolean =>
  typeof value === 'string' && /^[A-Za-z0-9-]{16,80}$/.test(value);

export function analyzeFinancialMigration(input: FinancialMigrationInput): FinancialMigrationReport {
  const findings: MigrationFinding[] = [];
  const branchKeyCounts = new Map<string, number>();
  const countKey = (key: string) => branchKeyCounts.set(key, (branchKeyCounts.get(key) || 0) + 1);

  input.ventas.forEach((v) => countKey(`venta:${v.sucursal_id}:${v.id}`));
  input.compras.forEach((p) => countKey(`compra:${p.sucursalId}:${p.id}`));

  input.ventas.forEach((sale) => {
    const unique = branchKeyCounts.get(`venta:${sale.sucursal_id}:${sale.id}`) === 1;
    findings.push({
      tipo: 'venta', idInterno: sale.id, registroId: sale.registroId, sucursalId: sale.sucursal_id,
      estado: hasStableId(sale.registroId) ? 'conservar' : unique ? 'asociacion_segura' : 'revision_manual',
      motivo: hasStableId(sale.registroId) ? 'Ya tiene identificador estable.' :
        unique ? 'La combinación sucursal + número interno identifica una sola venta; se puede asignar un identificador nuevo en una migración posterior.' :
        'Hay más de una venta con la misma sucursal y número interno.',
    });
  });
  input.compras.forEach((purchase) => {
    const unique = branchKeyCounts.get(`compra:${purchase.sucursalId}:${purchase.id}`) === 1;
    findings.push({
      tipo: 'compra', idInterno: purchase.id, registroId: purchase.registroId, sucursalId: purchase.sucursalId,
      estado: hasStableId(purchase.registroId) ? 'conservar' : unique ? 'asociacion_segura' : 'revision_manual',
      motivo: hasStableId(purchase.registroId) ? 'Ya tiene identificador estable.' :
        unique ? 'La combinación sucursal + número interno identifica una sola compra.' :
        'Hay más de una compra con la misma sucursal y número interno.',
    });
  });

  input.cxc.forEach((account) => {
    const matches = account.ventaId == null ? [] : input.ventas.filter((sale) =>
      sale.id === account.ventaId && (account.sucursalId == null || sale.sucursal_id === account.sucursalId));
    const linkedBranch = account.sucursalId ?? (matches.length === 1 ? matches[0].sucursal_id : undefined);
    const safe = matches.length === 1 && branchKeyCounts.get(`venta:${matches[0].sucursal_id}:${matches[0].id}`) === 1;
    const state = hasStableId(account.registroId) ? 'conservar' : safe ? 'asociacion_segura' : 'revision_manual';
    findings.push({
      tipo: 'cxc', idInterno: account.id, registroId: account.registroId, sucursalId: linkedBranch,
      estado: state,
      referencia: matches.length === 1 ? `venta #${matches[0].id}` : undefined,
      motivo: hasStableId(account.registroId) ? 'La cuenta ya tiene identificador estable.' :
        safe ? 'Existe exactamente una venta coincidente dentro de la sucursal.' :
        account.ventaId == null ? 'No tiene una venta de origen; requiere asignación manual de sucursal y revisión del comprobante.' :
        matches.length === 0 ? 'No se encontró una venta coincidente en la sucursal indicada.' :
        'La referencia coincide con varias ventas o no permite determinar una sucursal única.',
    });
    (account.abonos || []).forEach((movement) => findings.push({
      tipo: 'abono', idInterno: movement.id, registroId: movement.registroId, sucursalId: linkedBranch,
      estado: hasStableId(movement.registroId) ? 'conservar' : safe ? 'asociacion_segura' : 'revision_manual',
      motivo: hasStableId(movement.registroId) ? 'El abono ya tiene identificador estable.' :
        safe ? 'Puede recibir identificador nuevo ligado a la cuenta identificada de forma única.' :
        'No se debe migrar el abono hasta aclarar la cuenta y su sucursal.',
    }));
  });

  input.cxp.forEach((account) => {
    const byId = account.compraId == null ? [] : input.compras.filter((purchase) =>
      purchase.id === account.compraId && purchase.proveedorId === account.proveedorId &&
      (account.sucursalId == null || purchase.sucursalId === account.sucursalId));
    const byInvoice = account.numeroFactura.trim() ? input.compras.filter((purchase) =>
      purchase.numeroFactura?.trim().toLowerCase() === account.numeroFactura.trim().toLowerCase() &&
      purchase.proveedorId === account.proveedorId &&
      (account.sucursalId == null || purchase.sucursalId === account.sucursalId)) : [];
    const matches = account.compraId != null ? byId : byInvoice;
    const safe = matches.length === 1 &&
      branchKeyCounts.get(`compra:${matches[0].sucursalId}:${matches[0].id}`) === 1;
    const linkedBranch = account.sucursalId ?? (safe ? matches[0].sucursalId : undefined);
    findings.push({
      tipo: 'cxp', idInterno: account.id, registroId: account.registroId, sucursalId: linkedBranch,
      estado: hasStableId(account.registroId) ? 'conservar' : safe ? 'asociacion_segura' : 'revision_manual',
      referencia: safe ? `compra #${matches[0].id} / ${matches[0].numeroFactura || 'sin factura'}` : undefined,
      motivo: hasStableId(account.registroId) ? 'La cuenta ya tiene identificador estable.' :
        safe ? 'Coinciden de forma única proveedor, factura o referencia interna y sucursal.' :
        matches.length === 0 ? 'No se encontró una compra verificable con proveedor y sucursal coincidentes.' :
        'Hay varias compras posibles; requiere cotejar la factura original.',
    });
    (account.pagos || []).forEach((movement) => findings.push({
      tipo: 'pago', idInterno: movement.id, registroId: movement.registroId, sucursalId: linkedBranch,
      estado: hasStableId(movement.registroId) ? 'conservar' : safe ? 'asociacion_segura' : 'revision_manual',
      motivo: hasStableId(movement.registroId) ? 'El pago ya tiene identificador estable.' :
        safe ? 'Puede recibir identificador nuevo ligado a la cuenta identificada de forma única.' :
        'No se debe migrar el pago hasta aclarar la cuenta y su sucursal.',
    }));
  });

  const resumen = {
    conservar: findings.filter((item) => item.estado === 'conservar').length,
    asociacionSegura: findings.filter((item) => item.estado === 'asociacion_segura').length,
    revisionManual: findings.filter((item) => item.estado === 'revision_manual').length,
  };
  return { soloLectura: true, resumen, registros: findings };
}
